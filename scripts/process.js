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
  const imageUrl = process.env.IMAGE_URL;
  const imagePath = process.env.IMAGE_PATH;
  const apiKey = process.env.GEMINI_API_KEY;
  const issueNumber = process.env.ISSUE_NUMBER || 'local';
  const shelfId = process.env.SHELF_ID || 'unknown';

  if ((!imageUrl && !imagePath) || !apiKey) {
    console.error("Missing IMAGE_URL/IMAGE_PATH or GEMINI_API_KEY environment variables");
    process.exit(1);
  }

  let base64Image;
  let mimeType = 'image/jpeg';
  let filename = '';

  if (imagePath) {
    filename = path.basename(imagePath);
    console.log(`Reading image from file ${imagePath}...`);
    try {
      const fileData = fs.readFileSync(imagePath);
      base64Image = fileData.toString('base64');
      const ext = path.extname(imagePath).toLowerCase();
      if (ext === '.png') mimeType = 'image/png';
      else if (ext === '.webp') mimeType = 'image/webp';
      else if (ext === '.heic') mimeType = 'image/heic';
    } catch (err) {
      console.error("Error reading local image:", err);
      process.exit(1);
    }
  } else {
    try {
      const parsedUrl = new URL(imageUrl);
      filename = path.basename(parsedUrl.pathname);
    } catch (e) {
      filename = imageUrl;
    }
    console.log(`Downloading image from ${imageUrl}...`);
    try {
      const imgResponse = await fetch(imageUrl);
      if (!imgResponse.ok) throw new Error(`Failed to fetch image: ${imgResponse.statusText}`);
      const arrayBuffer = await imgResponse.arrayBuffer();
      base64Image = Buffer.from(arrayBuffer).toString('base64');
      mimeType = imgResponse.headers.get('content-type') || mimeType;
    } catch (err) {
      console.error("Error downloading image:", err);
      process.exit(1);
    }
  }

  console.log("Image downloaded. Calling Gemini API...");

  const prompt = `Look at this picture of a public bookcase. Identify all the books you can clearly see. 
For each book, determine the 'title' and 'author'.
If you cannot identify a property, return "unknown" for that field (do not use null or strings like "not visible").
If both 'title' and 'author' are "unknown" for a book, do not include it in the results.
Return a JSON array of objects with keys 'title' and 'author'.
Ensure your response is valid JSON.`;

  const requestBody = {
    contents: [{
      parts: [
        { text: prompt },
        { inlineData: { mimeType, data: base64Image } }
      ]
    }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json"
    }
  };

  let geminiOutput = [];
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
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
  } catch (e) {
    // File might not exist or be empty
  }

  let photoLat = null;
  let photoLon = null;
  let photoTimestamp = null;

  // Expected format: YYYYMMDD_HHMMSS_LAT_LON.ext
  const match = filename.match(/(\d{8}_\d{6})_([-\d.]+)_([-\d.]+)\.[a-zA-Z0-9]+$/);
  if (match) {
    photoTimestamp = match[1];
    photoLat = parseFloat(match[2]);
    photoLon = parseFloat(match[3]);
    console.log(`Extracted EXIF from filename: Time=${photoTimestamp}, Lat=${photoLat}, Lon=${photoLon}`);
  }

  let matchedShelfId = shelfId;

  if (photoLat !== null && photoLon !== null) {
    try {
      const bookshelves = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'bookshelves.json'), 'utf8'));
      let minDistance = Infinity;
      let closestShelfId = null;
      for (const shelf of bookshelves) {
        const dist = getDistanceFromLatLonInM(photoLat, photoLon, shelf.lat, shelf.lon);
        if (dist < minDistance) {
          minDistance = dist;
          closestShelfId = shelf.id;
        }
      }
      if (minDistance <= 500) {
        matchedShelfId = closestShelfId;
        console.log(`Matched bookshelf ${matchedShelfId} at distance ${minDistance.toFixed(2)}m`);
      } else {
        console.log(`No bookshelf found within 500m (closest is ${minDistance.toFixed(2)}m)`);
      }
    } catch (e) {
      console.log('Could not load bookshelves.json to match coordinates.');
    }
  }

  const currentTimestamp = new Date().toISOString();
  let bookTimestamp = currentTimestamp;

  if (photoTimestamp) {
    const yyyy = photoTimestamp.substring(0, 4);
    const mm = photoTimestamp.substring(4, 6);
    const dd = photoTimestamp.substring(6, 8);
    const hh = photoTimestamp.substring(9, 11);
    const min = photoTimestamp.substring(11, 13);
    const ss = photoTimestamp.substring(13, 15);
    try {
      bookTimestamp = new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}Z`).toISOString();
    } catch (e) {
      console.error("Invalid photo timestamp format, using current time");
    }
  }

  for (const book of geminiOutput) {
    const title = (book.title || 'unknown').toLowerCase() === 'unknown' ? 'unknown' : book.title;
    const author = (book.author || 'unknown').toLowerCase() === 'unknown' ? 'unknown' : book.author;

    // Skip if both are unknown
    if (title === 'unknown' && author === 'unknown') continue;

    data.push({
      title: title,
      author: author,
      timestamp: bookTimestamp,
      bookshelfId: matchedShelfId
    });
  }

  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
  console.log("books.json successfully updated.");
}

main();
