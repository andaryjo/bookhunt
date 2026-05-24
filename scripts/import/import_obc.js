const fs = require('fs');
const path = require('path');
const https = require('https');

const API_URL = 'https://openbookcase.de/api/listsection';
const OUTPUT_PATH = path.join(__dirname, '..', '..', 'public', 'data', 'bookshelves', 'bookshelves_obc.json');

/**
 * Generates a 6-letter unique ID
 */
function generateId() {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += letters.charAt(Math.floor(Math.random() * letters.length));
  }
  return result;
}

/**
 * Extracts name and address from the HTML string provided by the API
 */
function extractNameAndAddress(html) {
  // Expected format: <strong>Name</strong><br/><small>Address</small>
  const nameMatch = html.match(/<strong>(.*?)<\/strong>/);
  const addressMatch = html.match(/<small>(.*?)<\/small>/);
  
  // Clean up HTML entities/tags and trim
  // We use a simple regex for tags, for a script this is sufficient
  const name = nameMatch ? nameMatch[1].replace(/<[^>]+>/g, '').trim() : "Public Bookshelf";
  const address = addressMatch ? addressMatch[1].replace(/<[^>]+>/g, '').trim() : "";
  
  return { name, address };
}

/**
 * Extracts the numeric sourceId from the last string in the array
 */
function extractSourceId(html) {
  // Expected format: <a href="/map/show/1096" ...
  const match = html.match(/\/map\/show\/(\d+)/);
  return match ? 'obc_' + match[1] : null;
}

/**
 * Fetches data from the remote API
 */
async function fetchRemoteData(url) {
  return new Promise((resolve, reject) => {
    console.log(`Fetching data from ${url}... (this may take a while)`);
    https.get(url, {
      headers: {
        'User-Agent': 'Bookhunt-Import-Script/1.0'
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${e.message}`));
        }
      });
    }).on('error', (err) => reject(err));
  });
}

/**
 * Main import function
 */
async function importObc() {
  let existingBookshelves = [];
  if (fs.existsSync(OUTPUT_PATH)) {
    console.log(`Loading existing data from ${OUTPUT_PATH}...`);
    try {
      existingBookshelves = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
    } catch (e) {
      console.warn(`Could not parse existing data, starting fresh: ${e.message}`);
    }
  }

  // Optimize lookup: Create maps/arrays for matching
  const existingBySourceId = new Map();
  const existingWithoutSourceId = [];
  existingBookshelves.forEach(b => {
    if (b.sourceId) {
      existingBySourceId.set(b.sourceId, b);
    } else {
      existingWithoutSourceId.push(b);
    }
  });

  try {
    const response = await fetchRemoteData(API_URL);
    const sourceData = response.data || [];
    console.log(`Processing ${sourceData.length} bookshelves from OpenBookCase...`);

    const newBookshelvesList = [];
    const matchedExistingIds = new Set();

    sourceData.forEach(record => {
      // record structure:
      // [0]: Name/Address HTML
      // [1]: Latitude (string)
      // [2]: Longitude (string)
      // [record.length - 1]: Last string containing the map link (and source ID)
      
      const { name, address } = extractNameAndAddress(record[0]);
      const lat = parseFloat(record[1]);
      const lon = parseFloat(record[2]);
      const sourceId = extractSourceId(record[record.length - 1]);

      if (!sourceId || isNaN(lat) || isNaN(lon)) return;

      // Match logic:
      // 1. Prioritize sourceId match
      let existing = existingBySourceId.get(sourceId);
      
      // 2. Fallback to coordinates if no sourceId available in target file
      if (!existing) {
        const coordIdx = existingWithoutSourceId.findIndex(b => 
          !matchedExistingIds.has(b.id) &&
          Math.abs(b.lat - lat) < 0.00001 && 
          Math.abs(b.lon - lon) < 0.00001
        );
        if (coordIdx !== -1) {
          existing = existingWithoutSourceId[coordIdx];
        }
      }

      if (existing) {
        // Update metadata
        existing.name = name;
        existing.address = address;
        existing.sourceId = sourceId; // Ensure it has the obc_ prefix sourceId
        delete existing.removed; // Ensure it is active again if it was previously marked as removed
        
        // Keep it in the new list
        newBookshelvesList.push(existing);
        matchedExistingIds.add(existing.id);
      } else {
        // Create new bookshelf entry
        newBookshelvesList.push({
          id: generateId(),
          name: name,
          address: address,
          lat: lat,
          lon: lon,
          sourceId: sourceId
        });
      }
    });

    // Mark bookshelves not in source as removed instead of deleting them
    let removedCount = 0;
    existingBookshelves.forEach(existing => {
      if (!matchedExistingIds.has(existing.id)) {
        existing.removed = true;
        newBookshelvesList.push(existing);
        removedCount++;
      }
    });

    console.log(`Summary:`);
    console.log(`- Total from source: ${sourceData.length}`);
    console.log(`- Kept/Updated: ${matchedExistingIds.size}`);
    console.log(`- New added: ${newBookshelvesList.length - matchedExistingIds.size - removedCount}`);
    console.log(`- Marked as removed (not in source): ${removedCount}`);

    // Ensure directory exists
    const dir = path.dirname(OUTPUT_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Overwrite target file
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(newBookshelvesList, null, 2));
    console.log(`Successfully updated ${OUTPUT_PATH}`);

  } catch (error) {
    console.error('Error during import:', error.message);
    process.exit(1);
  }
}

importObc();
