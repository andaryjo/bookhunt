const path = require('path');
const {
  loadExisting,
  writeBookshelves,
  fetchRemoteData,
  reconcileBookshelves
} = require('./shared');

const API_URL = 'https://openbookcase.de/api/listsection';
const OUTPUT_PATH = path.join(__dirname, '..', '..', 'public', 'data', 'bookshelves', 'bookshelves_obc.json');

/**
 * Extracts name and address from the HTML string provided by the API
 */
function extractNameAndAddress(html) {
  // Expected format: <strong>Name</strong><br/><small>Address</small>
  const nameMatch = html.match(/<strong>(.*?)<\/strong>/);
  const addressMatch = html.match(/<small>(.*?)<\/small>/);
  
  // Clean up HTML entities/tags and trim
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
 * Main import function
 */
async function importObc() {
  const existingBookshelves = loadExisting(OUTPUT_PATH);

  try {
    console.log(`Fetching data from ${API_URL}... (this may take a while)`);
    const rawData = await fetchRemoteData(API_URL);
    let response;
    try {
      response = JSON.parse(rawData);
    } catch (e) {
      throw new Error(`Failed to parse JSON: ${e.message}`);
    }

    const sourceData = response.data || [];
    console.log(`Processing ${sourceData.length} bookshelves from OpenBookCase...`);

    const incomingItems = [];

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
