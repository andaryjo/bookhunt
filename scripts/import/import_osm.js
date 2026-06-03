const fs = require('fs');
const path = require('path');
const {
  loadExisting,
  writeBookshelves,
  reconcileBookshelves
} = require('./shared');

const inputPath = path.join(__dirname, '..', '..', 'export.geojson');
const outputPath = path.join(__dirname, '..', '..', 'public', 'data', 'bookshelves', 'bookshelves_osm.json');

function importOsm() {
  console.log(`Loading data from ${inputPath}...`);
  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const existingBookshelves = loadExisting(outputPath);

  const data = fs.readFileSync(inputPath, 'utf8');
  let geojson;
  try {
    geojson = JSON.parse(data);
  } catch (e) {
    console.error(`Failed to parse GeoJSON: ${e.message}`);
    process.exit(1);
  }

  console.log(`Processing ${geojson.features.length} features from OSM...`);

  const incomingItems = [];

  geojson.features.forEach(feature => {
    const props = feature.properties;
    const geometry = feature.geometry;
    
    let lon, lat;
    if (geometry.type === 'Point') {
      [lon, lat] = geometry.coordinates;
    } else if (geometry.type === 'LineString' || geometry.type === 'Polygon') {
      const coords = geometry.type === 'Polygon' ? geometry.coordinates[0][0] : geometry.coordinates[0];
      [lon, lat] = coords;
    }

    if (lat === undefined || lon === undefined) return;

    const rawId = feature.id || props['@id'] || '';
    const sourceId = "osm_" + rawId.replace('node/', '').replace('way/', '').replace('relation/', '');

    // Simple Name Generation
    const name = props.name || "Public Bookshelf";

    incomingItems.push({
      sourceId,
      name,
      address: null, // Address quality is too bad, skipping to rely on enrichment
      lat,
      lon
    });
  });

  const { bookshelves, stats } = reconcileBookshelves(existingBookshelves, incomingItems, {
    preserveAddressIfNull: true,
    preserveNameIfGeneric: true
  });

  console.log(`Summary:`);
  console.log(`- Total from source: ${stats.totalSource}`);
  console.log(`- Kept/Updated: ${stats.updated}`);
  console.log(`- New added: ${stats.newAdded}`);
  console.log(`- Marked as removed (not in source): ${stats.removed}`);

  writeBookshelves(outputPath, bookshelves);
  process.exit(0);
}

importOsm();
