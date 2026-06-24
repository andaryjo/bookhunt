const fs = require("fs");
const path = require("path");
const https = require("https");
const zlib = require("zlib");

const genericNames = [
  "Public Bookshelf",
  "Public bookcase",
  "StreetLibrary",
  "Öffentlicher Bücherschrank",
  "Little Free Library",
];

/**
 * Generates a 6-letter unique ID
 */
function generateId() {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += letters.charAt(Math.floor(Math.random() * letters.length));
  }
  return result;
}

/**
 * Loads existing data from output file
 */
function loadExisting(outputPath) {
  if (fs.existsSync(outputPath)) {
    console.log(`Loading existing data from ${outputPath}...`);
    try {
      return JSON.parse(fs.readFileSync(outputPath, "utf8"));
    } catch (e) {
      console.warn(
        `Could not parse existing data, starting fresh: ${e.message}`,
      );
    }
  }
  return [];
}

/**
 * Writes data back to the output path
 */
function writeBookshelves(outputPath, list) {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(outputPath, JSON.stringify(list, null, 2));
  console.log(`Successfully updated ${outputPath}`);
}

/**
 * Fetches remote data from a URL, automatically handling redirects
 */
async function fetchRemoteData(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            "User-Agent": "Bookhunt-Import-Script/1.0",
            Connection: "close",
          },
        },
        (res) => {
          // Handle redirects
          if (
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            resolve(fetchRemoteData(res.headers.location));
            return;
          }

          if (res.statusCode !== 200) {
            reject(new Error(`Failed to fetch (Status ${res.statusCode})`));
            return;
          }

          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => resolve(data));
        },
      )
      .on("error", (err) => reject(err));
  });
}

/**
 * Reconciles the incoming items with the existing database
 */
function reconcileBookshelves(
  existingBookshelves,
  incomingItems,
  options = {},
) {
  const existingBySourceId = new Map();
  const existingWithoutSourceId = [];

  existingBookshelves.forEach((b) => {
    if (b.sourceId) {
      existingBySourceId.set(b.sourceId, b);
    } else {
      existingWithoutSourceId.push(b);
    }
  });

  const reconciledList = [];
  const matchedExistingIds = new Set();
  let newAddedCount = 0;
  let updatedCount = 0;

  incomingItems.forEach((item) => {
    const { sourceId, name, address, lat, lon } = item;
    if (isNaN(lat) || isNaN(lon)) return;

    // 1. Prioritize sourceId match
    let existing = sourceId ? existingBySourceId.get(sourceId) : null;

    // 2. Fallback to coordinates
    if (!existing) {
      const coordIdx = existingWithoutSourceId.findIndex(
        (b) =>
          !matchedExistingIds.has(b.id) &&
          Math.abs(b.lat - lat) < 0.00001 &&
          Math.abs(b.lon - lon) < 0.00001,
      );
      if (coordIdx !== -1) {
        existing = existingWithoutSourceId[coordIdx];
      }
    }

    if (existing) {
      // Update metadata
      if (
        options.preserveNameIfGeneric &&
        genericNames.includes(name) &&
        existing.name &&
        !genericNames.includes(existing.name)
      ) {
        // Keep existing name
      } else {
        existing.name = name;
      }

      if (
        options.preserveAddressIfNull &&
        (address === null || address === undefined || address === "") &&
        existing.address
      ) {
        // Keep existing address
      } else {
        existing.address = address !== undefined ? address : null;
      }

      if (sourceId) {
        existing.sourceId = sourceId;
      } else {
        delete existing.sourceId;
      }

      delete existing.removed; // Ensure it is active again if it was previously marked as removed

      reconciledList.push(existing);
      matchedExistingIds.add(existing.id);
      updatedCount++;
    } else {
      // Create new entry
      const newItem = {
        id: generateId(),
        name: name,
        address: address !== undefined ? address : null,
        lat: lat,
        lon: lon,
      };
      if (sourceId) {
        newItem.sourceId = sourceId;
      }
      reconciledList.push(newItem);
      newAddedCount++;
    }
  });

  // Mark bookshelves not in source as removed instead of deleting them
  let removedCount = 0;
  if (!options.doNotRemoveIfMissing) {
    existingBookshelves.forEach((existing) => {
      if (!matchedExistingIds.has(existing.id)) {
        if (!existing.removed) {
          removedCount++;
        }
        existing.removed = true;
        reconciledList.push(existing);
      }
    });
  }

  return {
    bookshelves: reconciledList,
    stats: {
      totalSource: incomingItems.length,
      updated: updatedCount,
      newAdded: newAddedCount,
      removed: removedCount,
    },
  };
}

/**
 * Loads data from either a local file or a remote URL
 */
async function loadSourceData(source) {
  if (source.startsWith("http://") || source.startsWith("https://")) {
    console.log(`Downloading and decompressing remote data from ${source}...`);
    return fetchGzippedJson(source);
  }

  console.log(`Reading local file from ${source}...`);
  const fileBuffer = fs.readFileSync(source);
  if (source.endsWith(".gz")) {
    const decompressed = zlib.gunzipSync(fileBuffer);
    return JSON.parse(decompressed.toString("utf8"));
  }
  return JSON.parse(fileBuffer.toString("utf8"));
}

/**
 * Downloads gzipped data from the URL
 */
function fetchGzippedJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            "User-Agent": "Bookhunt-Import-Script/1.0",
            "Accept-Encoding": "gzip",
            Connection: "close",
          },
        },
        (res) => {
          // Handle redirects
          if (
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            resolve(fetchGzippedJson(res.headers.location));
            return;
          }

          if (res.statusCode !== 200) {
            reject(new Error(`Failed to fetch (Status ${res.statusCode})`));
            return;
          }

          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            const buffer = Buffer.concat(chunks);
            zlib.gunzip(buffer, (err, decompressed) => {
              if (err) {
                reject(err);
              } else {
                try {
                  const json = JSON.parse(decompressed.toString("utf8"));
                  resolve(json);
                } catch (e) {
                  reject(e);
                }
              }
            });
          });
        },
      )
      .on("error", (err) => reject(err));
  });
}

module.exports = {
  genericNames,
  generateId,
  loadExisting,
  writeBookshelves,
  fetchRemoteData,
  reconcileBookshelves,
  loadSourceData,
};
