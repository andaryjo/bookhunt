const path = require("path");

const {
  loadExisting,
  writeBookshelves,
  reconcileBookshelves,
  loadSourceData,
} = require("./shared");

const API_URL = "https://openbookcase.de/api/bookcase/export?gzip=1";
const OUTPUT_PATH = path.join(
  __dirname,
  "..",
  "..",
  "public",
  "data",
  "bookshelves",
  "bookshelves_obc.json",
);

/**
 * Formats structured address fields into a single string
 */
function formatAddress(addressObj) {
  if (!addressObj) return "";
  const parts = [];
  const streetPart = [addressObj.street, addressObj.houseNumber]
    .filter(Boolean)
    .join(" ");
  if (streetPart) parts.push(streetPart);

  const cityPart = [addressObj.zipcode, addressObj.city]
    .filter(Boolean)
    .join(" ");
  if (cityPart) parts.push(cityPart);

  if (addressObj.additionalData) {
    parts.push(addressObj.additionalData);
  }

  return parts.join(", ").trim();
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
    console.log(
      `Processing ${sourceData.length} bookshelves from OpenBookCase source...`,
    );

    const incomingItems = [];

    sourceData.forEach((bc) => {
      // Disregard all bookshelves in the source that have the property "source: osm"
      if (bc.source === "osm") return;
      if (bc.status != "active") return;

      const lat = bc.position ? parseFloat(bc.position.latitude) : NaN;
      const lon = bc.position ? parseFloat(bc.position.longitude) : NaN;
      const sourceId = bc.shortCode ? `obc_${bc.shortCode}` : null;
      const name = bc.title ? bc.title.trim() : "Public Bookshelf";
      const address = formatAddress(bc.address);

      if (!sourceId || isNaN(lat) || isNaN(lon)) return;

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
  } catch (error) {
    console.error("Error during import:", error.message);
    process.exit(1);
  }
}

importObc();
