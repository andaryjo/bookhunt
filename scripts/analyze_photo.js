const fs = require('fs');
const path = require('path');

function getDistanceFromLatLonInM(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  const imgPath = process.argv[2];

  if (!imgPath || !apiKey) {
    console.error("Usage: GEMINI_API_KEY=... node scripts/analyze_photo.js <image_path>");
    process.exit(1);
  }

  console.log(`Processing image: ${imgPath}`);

  const parts = [
    {
      text: `Look at this picture of a public bookcase. Identify all the books you can clearly see. 
For each book, determine the 'title' and 'author'.
If you cannot identify a property, return "unknown" for that field (do not use null or strings like "not visible").
If both 'title' and 'author' are "unknown" for a book, do not include it in the results.
Return a JSON array of objects with keys 'title' and 'author'.
Ensure your response is valid JSON.` }
  ];

  let photoMeta = null;
  try {
    const fileData = fs.readFileSync(imgPath);
    const base64Image = fileData.toString('base64');
    let mimeType = 'image/jpeg';
    const ext = path.extname(imgPath).toLowerCase();
    if (ext === '.png') mimeType = 'image/png';
    else if (ext === '.webp') mimeType = 'image/webp';
    else if (ext === '.heic') mimeType = 'image/heic';

    parts.push({ inlineData: { mimeType, data: base64Image } });

    const filename = path.basename(imgPath);
    const match = filename.match(/(\d{8}_\d{6})_([-\d.]+)_([-\d.]+)\.[a-zA-Z0-9]+$/);
    if (match) {
      photoMeta = {
        timestamp: match[1],
        lat: parseFloat(match[2]),
        lon: parseFloat(match[3])
      };
    }
  } catch (err) {
    console.error(`Error reading image ${imgPath}:`, err);
    process.exit(1);
  }

  console.log("Image loaded. Calling Gemini API...");

  const requestBody = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json"
    }
  };

  let geminiOutput = [];
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${apiKey}`;
    const apiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!apiRes.ok) {
      const errorText = await apiRes.text();
      throw new Error(`Gemini API Error: ${apiRes.statusText} - ${errorText}`);
    }

    const jsonRes = await apiRes.json();
    const textResponse = jsonRes.candidates[0].content.parts[0].text;
    geminiOutput = JSON.parse(textResponse);
  } catch (err) {
    console.error("Error from Gemini API:", err);
    process.exit(1);
  }

  console.log(`Successfully extracted ${geminiOutput.length} books.`);

  const dataPath = path.join(__dirname, '..', 'data', 'books.json');
  let data = [];
  try {
    data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  } catch (e) { }

  let matchedShelfId = 'unknown';
  let bookDay = new Date().toISOString().split('T')[0];

  if (photoMeta) {
    // Match Shelf
    try {
      const bookshelves = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'bookshelves.json'), 'utf8'));
      let minDistance = Infinity;
      let closestShelfId = null;
      for (const shelf of bookshelves) {
        const dist = getDistanceFromLatLonInM(photoMeta.lat, photoMeta.lon, shelf.lat, shelf.lon);
        if (dist < minDistance) {
          minDistance = dist;
          closestShelfId = shelf.id;
        }
      }
      if (minDistance <= 500) {
        matchedShelfId = closestShelfId;
      }
    } catch (e) { }

    // Format Day
    const yyyy = photoMeta.timestamp.substring(0, 4);
    const mm = photoMeta.timestamp.substring(4, 6);
    const dd = photoMeta.timestamp.substring(6, 8);
    bookDay = `${yyyy}-${mm}-${dd}`;
  }

  const unknownBooks = [];
  for (const book of geminiOutput) {
    const title = (book.title || 'unknown').toLowerCase() === 'unknown' ? 'unknown' : book.title;
    const author = (book.author || 'unknown').toLowerCase() === 'unknown' ? 'unknown' : book.author;

    if (title === 'unknown' && author === 'unknown') continue;

    const bookEntry = {
      title: title,
      author: author,
      day: bookDay,
      bookshelfId: matchedShelfId
    };

    if (matchedShelfId === 'unknown') {
      unknownBooks.push(bookEntry);
    } else {
      data.push(bookEntry);
    }
  }

  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));

  if (unknownBooks.length > 0 && photoMeta) {
    const unknownFileName = `${photoMeta.timestamp}_${photoMeta.lat}_${photoMeta.lon}.json`;
    const remediateDir = path.join(__dirname, '..', 'data', 'remediate');
    
    if (!fs.existsSync(remediateDir)) {
      fs.mkdirSync(remediateDir, { recursive: true });
    }
    
    const unknownPath = path.join(remediateDir, unknownFileName);
    fs.writeFileSync(unknownPath, JSON.stringify(unknownBooks, null, 2));
    console.log(`Saved ${unknownBooks.length} unknown books to remediate/${unknownFileName}`);
  }

  console.log("Processing complete.");
}

main();
