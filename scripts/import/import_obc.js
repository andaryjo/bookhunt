const path = require('path');
const fs = require('fs');
const https = require('https');
const zlib = require('zlib');
const {
  loadExisting,
  writeBookshelves,
  reconcileBookshelves
} = require('./shared');

const API_URL = 'https://openbookcase.de/api/bookcase/export?gzip=1';
const OUTPUT_PATH = path.join(__dirname, '..', '..', 'public', 'data', 'bookshelves', 'bookshelves_obc.json');

/**
 * Formats structured address fields into a single string
 */
function formatAddress(addressObj) {
  if (!addressObj) return "";
  const parts = [];
  const streetPart = [addressObj.street, addressObj.houseNumber].filter(Boolean).join(' ');
  if (streetPart) parts.push(streetPart);
  
  const cityPart = [addressObj.zipcode, addressObj.city].filter(Boolean).join(' ');
  if (cityPart) parts.push(cityPart);
  
  if (addressObj.additionalData) {
    parts.push(addressObj.additionalData);
  }
  
  return parts.join(', ').trim();
}

/**
 * Downloads gzipped data from the URL
 */
function fetchGzippedJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Bookhunt-Import-Script/1.0',
        'Accept-Encoding': 'gzip',
        'Connection': 'close'
      }
    }, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(fetchGzippedJson(res.headers.location));
        return;
      }
      
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to fetch (Status ${res.statusCode})`));
        return;
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        zlib.gunzip(buffer, (err, decompressed) => {
          if (err) {
            reject(err);
          } else {
            try {
              const json = JSON.parse(decompressed.toString('utf8'));
              resolve(json);
            } catch (e) {
              reject(e);
            }
          }
        });
      });
    }).on('error', (err) => reject(err));
  });
}

/**
 * Loads data from either a local file or a remote URL
 */
async function loadSourceData(source) {
  if (source.startsWith('http://') || source.startsWith('https://')) {
    console.log(`Downloading and decompressing remote data from ${source}...`);
    return fetchGzippedJson(source);
  }
  
  console.log(`Reading local file from ${source}...`);
  const fileBuffer = fs.readFileSync(source);
  if (source.endsWith('.gz')) {
    const decompressed = zlib.gunzipSync(fileBuffer);
    return JSON.parse(decompressed.toString('utf8'));
  }
  return JSON.parse(fileBuffer.toString('utf8'));
}

/**
 * Main import function
 */
async function importObc() {
  const existingBookshelves = loadExisting(OUTPUT_PATH);
  const source = process.argv[2] || API_URL;

  try {
    const response = await loadSourceData(source);
    const sourceData = response.bookcases || [];
    console.log(`Processing ${sourceData.length} bookshelves from OpenBookCase source...`);

    // Build migration map from legacy ID to short code
    const legacyToShortCode = new Map();
    sourceData.forEach(bc => {
      if (bc.source === 'osm') return; // ignore OSM
      if (bc.legacyId && bc.shortCode) {
        legacyToShortCode.set(`obc_${bc.legacyId}`, `obc_${bc.shortCode}`);
      }
    });

    // Migrate existing source IDs in-place
    let migratedCount = 0;
    existingBookshelves.forEach(b => {
      if (b.sourceId && legacyToShortCode.has(b.sourceId)) {
        const newSourceId = legacyToShortCode.get(b.sourceId);
        console.log(`Migrating sourceId for bookshelf ${b.id}: ${b.sourceId} -> ${newSourceId}`);
        b.sourceId = newSourceId;
        migratedCount++;
      }
    });
    if (migratedCount > 0) {
      console.log(`Migrated ${migratedCount} existing bookshelves to use shortCode as sourceId.`);
    }

    const incomingItems = [];

    sourceData.forEach(bc => {
      // Disregard all bookshelves in the source that have the property "source: osm"
      if (bc.source === 'osm') return;

      const lat = bc.position ? parseFloat(bc.position.latitude) : NaN;
      const lon = bc.position ? parseFloat(bc.position.longitude) : NaN;
      const sourceId = bc.shortCode ? `obc_${bc.shortCode}` : null;
      const name = bc.title ? bc.title.trim() : 'Public Bookshelf';
      const address = formatAddress(bc.address);

      if (!sourceId || isNaN(lat) || isNaN(lon)) return;

      incomingItems.push({
        sourceId,
        name,
        address,
        lat,
        lon
      });
    });

    const { bookshelves, stats } = reconcileBookshelves(existingBookshelves, incomingItems);

    console.log(`Summary:`);
    console.log(`- Total from source: ${stats.totalSource}`);
    console.log(`- Kept/Updated: ${stats.updated}`);
    console.log(`- New added: ${stats.newAdded}`);
    console.log(`- Marked as removed (not in source): ${stats.removed}`);

    writeBookshelves(OUTPUT_PATH, bookshelves);
    process.exit(0);
  } catch (error) {
    console.error('Error during import:', error.message);
    process.exit(1);
  }
}

importObc();
