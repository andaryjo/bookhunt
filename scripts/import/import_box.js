const fs = require('fs');
const path = require('path');
const https = require('https');

const MAP_ID = '1Dewi_Pu6edOipM_UzJ6fxrmH54g';
const KML_URL = `https://www.google.com/maps/d/u/0/kml?mid=${MAP_ID}&forcekml=1`;
const OUTPUT_PATH = path.join(__dirname, '..', '..', 'public', 'data', 'bookshelves', 'bookshelves_box.json');

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
 * Extracts info from a Placemark block
 */
function extractInfo(placemark) {
  const nameMatch = placemark.match(/<name>([\s\S]*?)<\/name>/);
  const coordMatch = placemark.match(/<coordinates>\s*([\d.-]+),([\d.-]+)/);
  
  if (!coordMatch) return null;
  
  const lon = parseFloat(coordMatch[1]);
  const lat = parseFloat(coordMatch[2]);
  
  if (isNaN(lat) || isNaN(lon)) return null;

  let rawName = nameMatch ? nameMatch[1].trim() : "Public Bookshelf";
  
  // Clean up CDATA if present
  rawName = rawName.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
  
  // Clean up HTML entities
  rawName = rawName.replace(/&amp;/g, '&')
                   .replace(/&quot;/g, '"')
                   .replace(/&apos;/g, "'")
                   .replace(/&lt;/g, '<')
                   .replace(/&gt;/g, '>')
                   .replace(/&#39;/g, "'")
                   .replace(/&nbsp;/g, ' ');

  // Handle newlines and multiple spaces
  rawName = rawName.replace(/\r?\n|\r/g, ' ').replace(/\s+/g, ' ').trim();

  // Split name and address if possible (common pattern: "City - Street")
  let locationPart = rawName;
  let addressPart = "";
  
  if (rawName.includes(' - ')) {
    const parts = rawName.split(' - ');
    locationPart = parts[0].trim();
    addressPart = parts.slice(1).join(' - ').trim();
  }
  
  // Extract city name: strip postal codes and secondary location info (commas)
  let cityName = locationPart.replace(/^\d+\s*/, '').trim();
  if (cityName.includes(',')) {
    cityName = cityName.split(',')[0].trim();
  }

  // Construct name: Bücherschrank + City
  const name = `Bücherschrank ${cityName}`;
  
  // Use the full original name string (cleaned) as the address
  const address = rawName;
  
  return { name, address, lat, lon };
}

/**
 * Fetches data from the remote URL, handling redirects
 */
async function fetchRemoteData(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Bookhunt-Import-Script/1.0'
      }
    }, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(fetchRemoteData(res.headers.location));
        return;
      }
      
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to fetch KML (Status ${res.statusCode})`));
        return;
      }

      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', (err) => reject(err));
  });
}

/**
 * Main import function
 */
async function importBox() {
  console.log(`Starting import from Google My Maps (ID: ${MAP_ID})...`);
  
  let existingBookshelves = [];
  if (fs.existsSync(OUTPUT_PATH)) {
    try {
      existingBookshelves = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
      console.log(`Loaded ${existingBookshelves.length} existing bookshelves from ${OUTPUT_PATH}`);
    } catch (e) {
      console.warn(`Could not parse existing data, starting fresh: ${e.message}`);
    }
  }

  // Optimize lookup by coordinates (since we're dropping sourceId)
  const existingByCoord = new Map();
  existingBookshelves.forEach(b => {
    const key = `${parseFloat(b.lat).toFixed(6)}_${parseFloat(b.lon).toFixed(6)}`;
    existingByCoord.set(key, b);
  });

  try {
    const kmlContent = await fetchRemoteData(KML_URL);
    
    // Split KML into Placemark blocks
    const placemarkBlocks = kmlContent.match(/<Placemark>([\s\S]*?)<\/Placemark>/g) || [];
    console.log(`Found ${placemarkBlocks.length} placemarks in KML source.`);

    const newBookshelvesList = [];
    const matchedExistingIds = new Set();

    placemarkBlocks.forEach(block => {
      const info = extractInfo(block);
      if (!info) return;

      const { name, address, lat, lon } = info;
      const key = `${lat.toFixed(6)}_${lon.toFixed(6)}`;

      let existing = existingByCoord.get(key);
      
      if (existing) {
        // Update metadata
        existing.name = name;
        existing.address = address;
        // Ensure sourceId is removed if it existed in old data
        delete existing.sourceId;
        
        newBookshelvesList.push(existing);
        matchedExistingIds.add(existing.id);
      } else {
        // Create new entry (no sourceId)
        newBookshelvesList.push({
          id: generateId(),
          name,
          address,
          lat,
          lon
        });
      }
    });

    console.log(`Summary:`);
    console.log(`- Total from source: ${newBookshelvesList.length}`);
    console.log(`- Updated: ${matchedExistingIds.size}`);
    console.log(`- New added: ${newBookshelvesList.length - matchedExistingIds.size}`);
    console.log(`- Removed (stale): ${existingBookshelves.length - matchedExistingIds.size}`);

    const dir = path.dirname(OUTPUT_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(newBookshelvesList, null, 2));
    console.log(`Successfully updated ${OUTPUT_PATH}`);

  } catch (error) {
    console.error('Error during import:', error.message);
    process.exit(1);
  }
}

importBox();
