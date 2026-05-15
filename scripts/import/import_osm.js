const fs = require('fs');
const path = require('path');

const inputPath = path.join(__dirname, '..', '..', 'export.geojson');
const outputPath = path.join(__dirname, '..', '..', 'public', 'data', 'bookshelves', 'bookshelves_osm.json');

function generateId() {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += letters.charAt(Math.floor(Math.random() * letters.length));
  }
  return result;
}

function importOsm() {
  console.log(`Loading data from ${inputPath}...`);
  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const data = fs.readFileSync(inputPath, 'utf8');
  const geojson = JSON.parse(data);
  console.log(`Processing ${geojson.features.length} features from OSM...`);

  const bookshelves = [];

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

    const newItem = {
      id: generateId(),
      name: name,
      address: null, // Address quality is too bad, skipping
      city: null,
      lat: lat,
      lon: lon,
      sourceId: sourceId
    };

    bookshelves.push(newItem);
  });

  // Create directory if it doesn't exist
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(bookshelves, null, 2));
  console.log(`Successfully imported ${bookshelves.length} bookshelves to ${outputPath}`);
}

importOsm();
