const path = require("path");
const https = require("https");
const zlib = require("zlib");
const {
  loadExisting,
  writeBookshelves,
  reconcileBookshelves,
  loadSourceData,
} = require("./shared");

const BASE_API_URL = "https://appapi.littlefreelibrary.org/library/map.json";
const OUTPUT_PATH = path.join(
  __dirname,
  "..",
  "..",
  "public",
  "data",
  "bookshelves",
  "bookshelves_lfl.json",
);

/**
 * Fetches JSON over HTTPS, supporting redirects and gzip/deflate decompression.
 */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            "User-Agent": "Bookhunt-Import-Script/1.0",
            "Accept-Encoding": "gzip, deflate",
            Connection: "close",
          },
        },
        (res) => {
          if (
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            resolve(fetchJson(res.headers.location));
            return;
          }

          if (res.statusCode !== 200) {
            reject(
              new Error(`Failed to fetch (Status ${res.statusCode}): ${url}`),
            );
            return;
          }

          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            const buffer = Buffer.concat(chunks);
            const encoding = res.headers["content-encoding"];

            const parseBody = (str) => {
              try {
                resolve(JSON.parse(str));
              } catch (e) {
                reject(
                  new Error(`Failed to parse JSON from ${url}: ${e.message}`),
                );
              }
            };

            if (encoding === "gzip") {
              zlib.gunzip(buffer, (err, decoded) => {
                if (err) reject(err);
                else parseBody(decoded.toString("utf8"));
              });
            } else if (encoding === "deflate") {
              zlib.inflate(buffer, (err, decoded) => {
                if (err) reject(err);
                else parseBody(decoded.toString("utf8"));
              });
            } else {
              parseBody(buffer.toString("utf8"));
            }
          });
        },
      )
      .on("error", reject);
  });
}

/**
 * Fetches JSON with retry logic and exponential backoff.
 */
async function fetchWithRetry(url, maxRetries = 3, initialDelayMs = 1000) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await fetchJson(url);
    } catch (err) {
      attempt++;
      if (attempt >= maxRetries) throw err;
      const delay = initialDelayMs * Math.pow(2, attempt - 1);
      console.warn(
        `[Retry ${attempt}/${maxRetries}] ${err.message}. Retrying in ${delay}ms...`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

/**
 * Formats address parts into a single string.
 */
function formatAddress(item) {
  const parts = [
    item.Street__c,
    item.City__c,
    item.State_Province_Region__c,
    item.Postal_Zip_Code__c,
    item.Country__c,
  ]
    .filter(Boolean)
    .map((s) => String(s).trim())
    .filter(Boolean);

  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Extracts normalized bookshelf object from an LFL API record.
 */
function extractItem(item) {
  const lat = parseFloat(item.Library_Geolocation__Latitude__s);
  const lon = parseFloat(item.Library_Geolocation__Longitude__s);

  if (isNaN(lat) || isNaN(lon)) return null;

  const rawName = (
    "Little Free Library " + (item.List_As_Name__c || item.Library_Name__c || "")
  ).trim();
  const address = formatAddress(item);
  const sourceId = `lfl_${item.id}`;

  return {
    sourceId,
    name: rawName,
    address,
    lat,
    lon,
  };
}

/**
 * Parses command-line arguments.
 */
function parseArgs() {
  const args = process.argv.slice(2);
  let source = null;
  let maxPages = Infinity;
  let startPage = 1;
  let pageSize = 50;
  let delayMs = 200;

  for (const arg of args) {
    if (arg.startsWith("--max-pages=")) {
      maxPages = parseInt(arg.split("=")[1], 10);
    } else if (arg.startsWith("--start-page=")) {
      startPage = parseInt(arg.split("=")[1], 10);
    } else if (arg.startsWith("--page-size=")) {
      pageSize = parseInt(arg.split("=")[1], 10);
    } else if (arg.startsWith("--delay=")) {
      delayMs = parseInt(arg.split("=")[1], 10);
    } else if (!arg.startsWith("--")) {
      source = arg;
    }
  }

  return { source, maxPages, startPage, pageSize, delayMs };
}

/**
 * Main import routine.
 */
async function importLfl() {
  const { source, maxPages, startPage, pageSize, delayMs } = parseArgs();
  const existingBookshelves = loadExisting(OUTPUT_PATH);
  const incomingItems = [];

  try {
    if (source && !source.startsWith("http://") && !source.startsWith("https://")) {
      // Local file mode
      console.log(`Loading data from local file: ${source}...`);
      const fileData = await loadSourceData(source);
      const rawList = Array.isArray(fileData)
        ? fileData
        : fileData.libraries || [];

      console.log(`Processing ${rawList.length} items from file...`);
      for (const raw of rawList) {
        const item = extractItem(raw);
        if (item) incomingItems.push(item);
      }
    } else {
      // API mode with pagination
      let currentPage = startPage;
      let totalPages = null;
      let totalLibraries = null;
      let pagesFetched = 0;
      const isPartialRun = maxPages !== Infinity || startPage > 1;

      console.log(
        `Starting live import from Little Free Library API (page size: ${pageSize})...`,
      );
      if (isPartialRun) {
        console.log(
          `Partial run: startPage=${startPage}, maxPages=${maxPages}`,
        );
      }

      while (
        (totalPages === null || currentPage <= totalPages) &&
        pagesFetched < maxPages
      ) {
        const url = `${BASE_API_URL}?page=${currentPage}&page_size=${pageSize}`;
        const progressPrefix = totalPages
          ? `[Page ${currentPage}/${totalPages} (${((currentPage / totalPages) * 100).toFixed(1)}%)]`
          : `[Page ${currentPage}]`;

        process.stdout.write(
          `${progressPrefix} Fetching ${pageSize} items... `,
        );

        const data = await fetchWithRetry(url);

        if (!data || !Array.isArray(data.libraries)) {
          console.log(`Failed!`);
          console.warn(`Unexpected response structure on page ${currentPage}, stopping.`);
          break;
        }

        if (totalPages === null && data.page_count) {
          totalPages = data.page_count;
          totalLibraries = data.library_count;
        }

        let addedThisPage = 0;
        for (const lib of data.libraries) {
          const item = extractItem(lib);
          if (item) {
            incomingItems.push(item);
            addedThisPage++;
          }
        }

        console.log(
          `Received ${data.libraries.length} (${addedThisPage} valid). Total collected: ${incomingItems.length}`,
        );

        pagesFetched++;
        currentPage++;

        if (data.libraries.length < pageSize) {
          console.log("Reached last page of data.");
          break;
        }

        if (
          delayMs > 0 &&
          (totalPages === null || currentPage <= totalPages) &&
          pagesFetched < maxPages
        ) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    }

    console.log(`\nReconciling ${incomingItems.length} incoming items with existing database...`);
    const isPartialRun = maxPages !== Infinity || startPage > 1;
    const { bookshelves, stats } = reconcileBookshelves(
      existingBookshelves,
      incomingItems,
      {
        preserveAddressIfNull: true,
        preserveNameIfGeneric: true,
        doNotRemoveIfMissing: isPartialRun,
      },
    );

    console.log(`Summary:`);
    console.log(`- Total from source: ${stats.totalSource}`);
    console.log(`- Kept/Updated: ${stats.updated}`);
    console.log(`- New added: ${stats.newAdded}`);
    console.log(`- Marked as removed: ${stats.removed}`);

    writeBookshelves(OUTPUT_PATH, bookshelves);
    console.log(`Done! Total bookshelves in ${path.basename(OUTPUT_PATH)}: ${bookshelves.length}`);
    process.exit(0);
  } catch (error) {
    console.error("Error during import:", error.message);
    process.exit(1);
  }
}

importLfl();
