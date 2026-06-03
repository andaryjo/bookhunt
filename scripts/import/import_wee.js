const path = require('path');
const {
  loadExisting,
  writeBookshelves,
  fetchRemoteData,
  reconcileBookshelves
} = require('./shared');

const MAP_ID = '1utccy-2Gpt5VnjnZLEu0xJKWHCA';
const KML_URL = `https://www.google.com/maps/d/u/0/kml?mid=${MAP_ID}&forcekml=1`;
const OUTPUT_PATH = path.join(__dirname, '..', '..', 'public', 'data', 'bookshelves', 'bookshelves_wee.json');

/**
 * Extracts info from a Placemark block
 */
function extractInfo(placemark) {
  const nameMatch = placemark.match(/<name>([\s\S]*?)<\/name>/);
  const descMatch = placemark.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) || placemark.match(/<description>([\s\S]*?)<\/description>/);
  const coordMatch = placemark.match(/<coordinates>\s*([\d.-]+),([\d.-]+)/);
  
  if (!coordMatch) return null;
  
  const lon = parseFloat(coordMatch[1]);
  const lat = parseFloat(coordMatch[2]);
  
  if (isNaN(lat) || isNaN(lon)) return null;

  let cityName = nameMatch ? nameMatch[1].trim() : "Public Bookshelf";
  // Clean up CDATA if present
  cityName = cityName.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
  
  let rawAddress = descMatch ? descMatch[1].trim() : "";
  rawAddress = rawAddress.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
  
  // Clean up HTML entities
  cityName = cityName.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  rawAddress = rawAddress.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  
  // Handle newlines and multiple spaces
  cityName = cityName.replace(/\r?\n|\r/g, ' ').replace(/\s+/g, ' ').trim();
  rawAddress = rawAddress.replace(/\r?\n|\r/g, ' ').replace(/\s+/g, ' ').trim();

  // Strip html from description for address
  const address = rawAddress.replace(/<[^>]*>?/gm, '');

  const name = `Bücherschrank ${cityName}`;
  
  return { name, address, lat, lon };
}

/**
 * Main import function
 */
async function importWee() {
  console.log(`Starting import from Google My Maps (ID: ${MAP_ID})...`);
  
  const existingBookshelves = loadExisting(OUTPUT_PATH);

  try {
    const kmlContent = await fetchRemoteData(KML_URL);
    
    // Split KML into Placemark blocks
    const placemarkBlocks = kmlContent.match(/<Placemark>([\s\S]*?)<\/Placemark>/g) || [];
    console.log(`Found ${placemarkBlocks.length} placemarks in KML source.`);

    const incomingItems = [];

    placemarkBlocks.forEach(block => {
      const info = extractInfo(block);
      if (!info) return;

      const { name, address, lat, lon } = info;
      incomingItems.push({
        sourceId: null,
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

importWee();
