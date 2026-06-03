const path = require('path');
const {
  loadExisting,
  writeBookshelves,
  fetchRemoteData,
  reconcileBookshelves
} = require('./shared');

const MAP_ID = '1Dewi_Pu6edOipM_UzJ6fxrmH54g';
const KML_URL = `https://www.google.com/maps/d/u/0/kml?mid=${MAP_ID}&forcekml=1`;
const OUTPUT_PATH = path.join(__dirname, '..', '..', 'public', 'data', 'bookshelves', 'bookshelves_box.json');

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
 * Main import function
 */
async function importBox() {
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

importBox();
