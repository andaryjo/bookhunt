// this import script imports OSM bookshelvse but from the OBC data source where OSM shelves are marked with source = osm
// We do this temporarily to fill up on missing OSM bookshelves until our own import works more reliably

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
  "bookshelves_osm.json",
);

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
      if (bc.source != "osm") return;
      if (!bc.osmId) return;
      if (bc.type == "givebox") return;

      const lat = bc.position ? parseFloat(bc.position.latitude) : NaN;
      const lon = bc.position ? parseFloat(bc.position.longitude) : NaN;
      const sourceId = `osm_${bc.osmId.replace("n", "")}`;
      const name = bc.title;
      const address = null;

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
      {
        preserveAddressIfNull: true,
        preserveNameIfGeneric: true,
        doNotRemoveIfMissing: true,
      },
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
