const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  loadExisting,
  writeBookshelves,
  reconcileBookshelves,
} = require("./shared");

// The data comes from the source code of https://croquelivres.ca/reseau/
// There is a JS array called croqueLivres which we parse
// Needs to be done manually for now
const INPUT_PATH = path.join(__dirname, "livres.js");
const OUTPUT_PATH = path.join(
  __dirname,
  "..",
  "..",
  "public",
  "data",
  "bookshelves",
  "bookshelves_clc.json",
);

function extractAddress(html) {
  const cityMatch = html.match(/<div class="ville">(.*?)<\/div>/);
  const city = cityMatch ? cityMatch[1].trim() : "";

  const addressMatch = html.match(
    /<div class="ville">.*?<\/div>(.*?)<div class="contenant-bouton">/,
  );
  let streetAddress = addressMatch
    ? addressMatch[1]
        .replace(/&nbsp;/g, " ")
        .replace(/<[^>]+>/g, "")
        .trim()
    : "";

  let address = streetAddress;
  if (city) {
    if (address) {
      if (!address.toLowerCase().includes(city.toLowerCase())) {
        if (address.includes(", Québec")) {
          address = address.replace(", Québec", `, ${city}, Québec`);
        } else {
          address = `${address}, ${city}`;
        }
      }
    } else {
      address = city;
    }
  }
  return address || null;
}

function importClc() {
  console.log(`Loading data from ${INPUT_PATH}...`);
  if (!fs.existsSync(INPUT_PATH)) {
    console.error(`Input file not found: ${INPUT_PATH}`);
    process.exit(1);
  }

  const existingBookshelves = loadExisting(OUTPUT_PATH);

  const fileContent = fs.readFileSync(INPUT_PATH, "utf8");
  const context = {};
  vm.createContext(context);
  try {
    vm.runInContext(fileContent, context);
  } catch (e) {
    console.error(`Failed to evaluate livres.js: ${e.message}`);
    process.exit(1);
  }

  const croqueLivres = context.croqueLivres;
  if (!Array.isArray(croqueLivres)) {
    console.error(`croqueLivres is not an array or not defined`);
    process.exit(1);
  }

  console.log(
    `Processing ${croqueLivres.length} features from croqueLivres...`,
  );

  const incomingItems = [];

  croqueLivres.forEach((record) => {
    const id = record[0];
    const name = (record[1] || "").trim() || "Public Bookshelf";
    const lat = record[2];
    const lon = record[3];
    const html = record[6];

    if (!id || isNaN(lat) || isNaN(lon)) return;

    const sourceId = `clc_${id}`;
    const address = html ? extractAddress(html) : null;

    incomingItems.push({
      sourceId,
      name,
      address,
      lat,
      lon,
    });
  });

  const { bookshelves, stats } = reconcileBookshelves(
    existingBookshelves,
    incomingItems,
  );

  console.log(`Summary:`);
  console.log(`- Total from source: ${stats.totalSource}`);
  console.log(`- Kept/Updated: ${stats.updated}`);
  console.log(`- New added: ${stats.newAdded}`);
  console.log(`- Marked as removed (not in source): ${stats.removed}`);

  writeBookshelves(OUTPUT_PATH, bookshelves);
  process.exit(0);
}

importClc();
