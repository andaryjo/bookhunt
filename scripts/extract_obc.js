// This script extracts the bookshelves from the Open Bookcase List.
// The full list can be retrieved at https://openbookcase.de/api/listsection

const fs = require('fs');
const crypto = require('crypto');

const inputFile = './data/openbookcaselist.json';
const outputFile = './data/bookshelves.json';

try {
  const rawData = fs.readFileSync(inputFile, 'utf8');
  const jsonData = JSON.parse(rawData);

  if (jsonData && Array.isArray(jsonData.data)) {
    const coordinates = jsonData.data.map(item => {
      const html = item[0];

      // Extract name from <strong> and address from <small>
      const nameMatch = html.match(/<strong[^>]*>(.*?)<\/strong>/i);
      const addrMatch = html.match(/<small[^>]*>(.*?)<\/small>/i);

      let name = '';
      let address = '';

      if (nameMatch) {
        name = nameMatch[1].replace(/<[^>]*>?/gm, '').trim();
      }

      if (addrMatch) {
        address = addrMatch[1].replace(/<[^>]*>?/gm, '').trim();
      }

      // Fallback if tags are missing or extraction failed
      if (!name && !address) {
        const parts = html.split(/<br\s*\/?>/i);
        name = parts[0].replace(/<[^>]*>?/gm, '').trim();
        if (parts.length > 1) {
          address = parts.slice(1).join(' ').replace(/<[^>]*>?/gm, '').trim();
        }
      } else if (!name) {
        name = html.replace(/<small[^>]*>.*?<\/small>/i, '').replace(/<[^>]*>?/gm, '').trim();
      }

      return {
        id: crypto.randomUUID(),
        name: name || 'Unknown Bookshelf',
        address: address,
        lat: parseFloat(item[1]),
        lon: parseFloat(item[2])
      };
    });

    fs.writeFileSync(outputFile, JSON.stringify(coordinates, null, 2), 'utf8');
    console.log(`Successfully extracted ${coordinates.length} coordinates to ${outputFile}`);
  } else {
    console.error('Invalid JSON structure: "data" array not found.');
  }
} catch (error) {
  console.error('Error processing the file:', error.message);
}
