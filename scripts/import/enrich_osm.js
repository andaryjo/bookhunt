const fs = require("fs");
const path = require("path");
const https = require("https");

const { genericNames } = require("./shared");

const dataPath = path.join(
  __dirname,
  "..",
  "..",
  "public",
  "data",
  "bookshelves",
  "bookshelves_osm.json",
);

/**
 * Fetches geocoding info from Photon (OSM-based geocoder)
 */
async function fetchGeocode(lat, lon) {
  return new Promise((resolve, reject) => {
    // Photon reverse geocoding API
    const url = `https://photon.komoot.io/reverse?lon=${lon}&lat=${lat}`;

    const options = {
      headers: {
        "User-Agent": "BookHunt-Import-Bot/1.0",
      },
      timeout: 5000,
    };

    https
      .get(url, options, (res) => {
        if (res.statusCode !== 200) {
          return reject(new Error(`Status ${res.statusCode}`));
        }

        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            if (json.features && json.features.length > 0) {
              const props = json.features[0].properties;

              // Construct a readable address
              const street = props.street
                ? `${props.street}${props.housenumber ? " " + props.housenumber : ""}`
                : null;
              const city = props.city || props.town || props.village;

              const parts = [
                street,
                props.postcode,
                city,
                props.country,
              ].filter((p) => p && p.trim().length > 0);

              resolve({
                address: parts.join(", ") || null,
                city: city || null,
              });
            } else {
              resolve(null);
            }
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

async function enrich() {
  if (!fs.existsSync(dataPath)) {
    console.error(`File not found: ${dataPath}`);
    return;
  }

  const bookshelves = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const missing = bookshelves.filter((b) => !b.address);

  console.log(`Total bookshelves: ${bookshelves.length}`);
  console.log(`Found ${missing.length} missing addresses.`);

  if (missing.length === 0) {
    console.log("Nothing to enrich!");
    return;
  }

  // We limit to a small batch per run to respect Photon's usage policy
  // and avoid long-running processes.
  const limit = 20;
  console.log(`Enriching a batch of ${limit} items...`);

  for (let i = 0; i < limit; i++) {
    const b = missing[i];
    process.stdout.write(
      `[${i + 1}/${limit}] Geocoding ${b.id} (${b.lat}, ${b.lon})... `,
    );

    try {
      const result = await fetchGeocode(b.lat, b.lon);
      if (result) {
        if (result.address) b.address = result.address;

        // If the name is generic, append the city
        if (genericNames.includes("Public Bookshelf") && result.city) {
          b.name = `${b.name} ${result.city}`;
        }

        console.log(`✅ ${b.name} - ${b.address || "No address"}`);
      } else {
        console.log("❓ No address found.");
      }
    } catch (err) {
      console.log(`❌ Error: ${err.message}`);
      if (err.message.includes("429")) {
        console.log("Rate limit hit. Stopping for now.");
        break;
      }
    }

    // Wait 1 second between requests to be polite to the API
    await new Promise((r) => setTimeout(r, 1000));
  }

  fs.writeFileSync(dataPath, JSON.stringify(bookshelves, null, 2));
  console.log("\nSaved enriched data to bookshelves_osm.json");
}

enrich();
