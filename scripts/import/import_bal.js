const fs = require('fs');
const path = require('path');
const https = require('https');

const REMOTE_URL = 'https://raw.githubusercontent.com/Binnette/bookcases-boite-a-lire/master/bookcases/bookcases.geojson';
const outputPath = path.join(__dirname, '..', '..', 'public', 'data', 'bookshelves', 'bookshelves_bal.json');

// RFC 5322 compliant-ish email regex for stripping
const EMAIL_REGEX = /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*/g;

function sanitize(text) {
  if (!text) return '';
  return text.replace(EMAIL_REGEX, '').replace(/\s+,/g, ',').replace(/,+/g, ',').trim();
}

function generateId() {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += letters.charAt(Math.floor(Math.random() * letters.length));
  }
  return result;
}

async function fetchRemoteData(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
      res.on('error', (err) => reject(err));
    }).on('error', (err) => reject(err));
  });
}

async function importBal() {
  let existingBookshelves = [];
  if (fs.existsSync(outputPath)) {
    console.log(`Loading existing data from ${outputPath}...`);
    existingBookshelves = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  }

  const existingNames = new Set(existingBookshelves.map(b => b.name));
  
  console.log(`Fetching remote data from ${REMOTE_URL}...`);
  try {
    const geojson = await fetchRemoteData(REMOTE_URL);
    console.log(`Processing ${geojson.features.length} features from remote source...`);

    let newItemsCount = 0;
    geojson.features.forEach(feature => {
      const props = feature.properties;
      const coords = feature.geometry.coordinates;

      // Sanitize address for name derivation
      const sanitizedPropsAddress = sanitize(props.adresse);
      const nameFromAddress = sanitizedPropsAddress ? sanitizedPropsAddress.split(',')[0].trim() : 'Unknown location';
      const name = `Boite a lire ${nameFromAddress}`;

      // Only add if name doesn't exist yet
      if (existingNames.has(name)) return;

      const addressParts = [
        sanitizedPropsAddress,
        sanitize(props.code_postal),
        sanitize(props.ville),
        sanitize(props.pays)
      ].filter(p => p && p.trim().length > 0);

      const newItem = {
        id: generateId(),
        name: name,
        address: addressParts.join(', '),
        lat: coords[1],
        lon: coords[0],
        sourceId: props.id
      };

      existingBookshelves.push(newItem);
      existingNames.add(name);
      newItemsCount++;
    });

    if (newItemsCount > 0) {
      fs.writeFileSync(outputPath, JSON.stringify(existingBookshelves, null, 2));
      console.log(`Successfully added ${newItemsCount} new bookshelves. Total: ${existingBookshelves.length}`);
    } else {
      console.log('No new bookshelves found (all names already exist).');
    }
  } catch (error) {
    console.error('Error fetching or processing remote data:', error.message);
  }
}

// Create directory if it doesn't exist
const dir = path.dirname(outputPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

importBal();
