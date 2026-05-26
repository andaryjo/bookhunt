const fs = require("fs");
const path = require("path");


async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  const imgPath = process.argv[2];

  if (!imgPath || !apiKey) {
    console.error(
      "Usage: GEMINI_API_KEY=... node scripts/analyze_photo.js <image_path>",
    );
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
Ensure your response is valid JSON.`,
    },
  ];

  let photoMeta = null;
  try {
    const fileData = fs.readFileSync(imgPath);
    const base64Image = fileData.toString("base64");
    let mimeType = "image/jpeg";
    const ext = path.extname(imgPath).toLowerCase();
    if (ext === ".png") mimeType = "image/png";
    else if (ext === ".webp") mimeType = "image/webp";
    else if (ext === ".heic") mimeType = "image/heic";

    parts.push({ inlineData: { mimeType, data: base64Image } });
  } catch (err) {
    console.error(`Error reading image ${imgPath}:`, err);
    process.exit(1);
  }

  const filename = path.basename(imgPath);
  const baseName = filename.replace(/\.[^.]+$/, "");
  const queueDir = path.join(__dirname, "..", "queue");
  const jsonPath = path.join(queueDir, `${baseName}.json`);

  let matchedShelfId = "unknown";
  let bookDate = new Date().toISOString().split("T")[0];

  if (fs.existsSync(jsonPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
      if (meta.suggestedShelfId) {
        matchedShelfId = meta.suggestedShelfId;
      }
      if (meta.date) {
        const d = new Date(meta.date);
        if (!isNaN(d.getTime())) {
          bookDate = d.toISOString().split("T")[0];
        }
      }
      console.log(`Loaded metadata from JSON: ${JSON.stringify(meta)}`);
    } catch (e) {
      console.warn(`Failed to parse JSON metadata at ${jsonPath}:`, e.message);
    }
  }

  // Fallback to filename parsing if metadata is still missing
  if (matchedShelfId === "unknown") {
    const nameParts = baseName.split("_");
    if (nameParts.length >= 3) {
      // formats: <id>_<day>_<bookshelf_id>
      const [id, day, part3] = nameParts;

      // Normalize day to YYYY-MM-DD if it comes as YYYYMMDD
      if (day.length === 8 && !day.includes("-")) {
        bookDate = `${day.substring(0, 4)}-${day.substring(4, 6)}-${day.substring(6, 8)}`;
      } else {
        bookDate = day;
      }

      matchedShelfId = part3;
    }
  }

  console.log("Image loaded. Calling Gemini API...");

  const requestBody = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  };

  let geminiOutput = [];
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`;
    const apiRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    if (!apiRes.ok) {
      const errorText = await apiRes.text();
      throw new Error(`Gemini API Error: ${apiRes.statusText} - ${errorText}`);
    }

    const jsonRes = await apiRes.json();
    const textResponse = jsonRes.candidates[0].content.parts[0].text;
    geminiOutput = JSON.parse(textResponse);
  } catch (err) {
    if (err.message.includes("429")) {
      console.error("Quota exceeded (429). Exiting with code 42.");
      process.exit(42);
    }
    console.error("Error from Gemini API:", err);
    process.exit(1);
  }

  console.log(`Successfully extracted ${geminiOutput.length} books.`);

  const dataPath = path.join(__dirname, "..", "public", "data", "books.json");
  let data = [];
  try {
    data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  } catch (e) {}

  const unknownBooks = [];
  for (const book of geminiOutput) {
    const title =
      (book.title || "unknown").toLowerCase() === "unknown"
        ? "unknown"
        : book.title;
    const author =
      (book.author || "unknown").toLowerCase() === "unknown"
        ? "unknown"
        : book.author;

    if (title === "unknown" && author === "unknown") continue;

    const bookEntry = {
      title: title,
      author: author,
      date: bookDate,
      bookshelfId: matchedShelfId,
    };

    if (matchedShelfId === "unknown") {
      unknownBooks.push(bookEntry);
    } else {
      data.push(bookEntry);
    }
  }

  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));

  if (unknownBooks.length > 0) {
    const id = baseName.split("_")[0] || "unknown";
    const suffix = matchedShelfId;

    const dateStr = bookDate.replace(/-/g, "");
    const unknownFileName = `${id}_${dateStr}_${suffix}.json`;
    const remediateDir = path.join(
      __dirname,
      "..",
      "public",
      "data",
      "remediate",
    );

    if (!fs.existsSync(remediateDir)) {
      fs.mkdirSync(remediateDir, { recursive: true });
    }

    const unknownPath = path.join(remediateDir, unknownFileName);
    fs.writeFileSync(unknownPath, JSON.stringify(unknownBooks, null, 2));
    console.log(
      `Saved ${unknownBooks.length} unknown books to remediate/${unknownFileName}`,
    );
  }

  console.log("Analysis complete.");
  fs.unlinkSync(imgPath);
  console.log(`Deleted analyzed photo: ${imgPath}`);
}

main();
