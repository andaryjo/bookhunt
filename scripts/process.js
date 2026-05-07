const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const photosDir = path.join(__dirname, '..', 'photos');
const scriptPath = path.join(__dirname, 'analyze_photo.js');

async function main() {
  if (!fs.existsSync(photosDir)) {
    console.error(`Photos directory not found: ${photosDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(photosDir)
    .filter(file => /\.(jpg|jpeg)$/i.test(file))
    .sort();

  if (files.length === 0) {
    console.log("No photos found in the 'photos' folder.");
    return;
  }

  console.log(`Found ${files.length} photos to process.`);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = path.join(photosDir, file);
    
    console.log(`\n[${i + 1}/${files.length}] Processing ${file}...`);
    
    // Using spawnSync to process photos sequentially and capture exit codes
    const result = spawnSync('node', [scriptPath, filePath], {
      stdio: 'inherit',
      env: process.env
    });

    if (result.status === 42) {
      console.error('\n--- ABORTING: Gemini Quota Exceeded (429) ---');
      process.exit(42);
    }

    if (result.status !== 0) {
      console.warn(`Warning: Analysis failed for ${file} with exit code ${result.status}.`);
      // We continue on other errors, but the user specifically asked to abort on quota (42).
    }
  }

  console.log('\nProcessing complete. Starting deduplication...');
  deduplicateBooks();
}

function deduplicateBooks() {
  const dataPath = path.join(__dirname, '..', 'public', 'data', 'books.json');
  if (!fs.existsSync(dataPath)) return;

  try {
    const rawData = fs.readFileSync(dataPath, 'utf8');
    const books = JSON.parse(rawData);
    const initialCount = books.length;

    // Use a Map to store unique books. Key is "title|author|bookshelfId"
    const uniqueBooks = new Map();

    books.forEach(book => {
      const key = `${(book.title || '').toLowerCase()}|${(book.author || '').toLowerCase()}|${book.bookshelfId}`;
      const existing = uniqueBooks.get(key);

      if (!existing || new Date(book.date) > new Date(existing.date)) {
        uniqueBooks.set(key, book);
      }
    });

    const deduplicated = Array.from(uniqueBooks.values());
    
    // Sort by date ascending (oldest first, latest at the bottom)
    deduplicated.sort((a, b) => new Date(a.date) - new Date(b.date));

    fs.writeFileSync(dataPath, JSON.stringify(deduplicated, null, 2));
    console.log(`Deduplication complete: ${initialCount} -> ${deduplicated.length} books.`);
  } catch (e) {
    console.error('Error during deduplication:', e);
  }
}

main();

