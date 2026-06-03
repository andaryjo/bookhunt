const path = require('path');
const {
  loadExisting,
  writeBookshelves,
  fetchRemoteData,
  reconcileBookshelves
} = require('./shared');

const REMOTE_URL = 'https://raw.githubusercontent.com/Binnette/bookcases-boite-a-lire/master/bookcases/bookcases.geojson';
const OUTPUT_PATH = path.join(__dirname, '..', '..', 'public', 'data', 'bookshelves', 'bookshelves_bal.json');

// RFC 5322 compliant-ish email regex for stripping
const EMAIL_REGEX = /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*/g;

function sanitize(text) {
  if (!text) return '';
  return text.replace(EMAIL_REGEX, '').replace(/\s+,/g, ',').replace(/,+/g, ',').trim();
}

async function importBal() {
  const existingBookshelves = loadExisting(OUTPUT_PATH);

  console.log(`Fetching remote data from ${REMOTE_URL}...`);
  try {
    const rawData = await fetchRemoteData(REMOTE_URL);
    let geojson;
    try {
      geojson = JSON.parse(rawData);
    } catch (e) {
      throw new Error(`Failed to parse GeoJSON: ${e.message}`);
    }

    console.log(`Processing ${geojson.features.length} features from remote source...`);
    const incomingItems = [];

    geojson.features.forEach(feature => {
      const props = feature.properties;
      const coords = feature.geometry.coordinates;

      if (!coords || coords.length < 2) return;

      // Sanitize address for name derivation
      const sanitizedPropsAddress = sanitize(props.adresse);
      const nameFromAddress = sanitizedPropsAddress ? sanitizedPropsAddress.split(',')[0].trim() : 'Unknown location';
      const name = `Boite a lire ${nameFromAddress}`;

      const addressParts = [
        sanitizedPropsAddress,
        sanitize(props.code_postal),
        sanitize(props.ville),
        sanitize(props.pays)
      ].filter(p => p && p.trim().length > 0);

      incomingItems.push({
        sourceId: "bal_" + props.id,
        name: name,
        address: addressParts.join(', '),
        lat: coords[1],
        lon: coords[0]
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
    console.error('Error fetching or processing remote data:', error.message);
    process.exit(1);
  }
}

importBal();
