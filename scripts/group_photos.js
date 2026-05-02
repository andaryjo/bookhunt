const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getDistanceFromLatLonInM(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function parseFilename(filename) {
  const match = filename.match(/(\d{8})_(\d{6})_([-\d.]+)_([-\d.]+)\.[a-zA-Z0-9]+$/);
  if (!match) return null;
  return {
    day: match[1], // YYYYMMDD
    time: match[2],
    lat: parseFloat(match[3]),
    lon: parseFloat(match[4])
  };
}

async function main() {
  const targetDir = process.argv[2];
  if (!targetDir) {
    console.error("Usage: node scripts/group_photos.js <directory_with_images>");
    process.exit(1);
  }

  const files = fs.readdirSync(targetDir)
    .filter(f => /\.(jpg|jpeg|png|webp|heic)$/i.test(f))
    .map(f => ({
      path: path.join(targetDir, f),
      meta: parseFilename(f)
    }))
    .filter(f => f.meta !== null);

  if (files.length === 0) {
    console.log("No valid images found.");
    return;
  }

  console.log(`Found ${files.length} images. Grouping...`);

  const groups = [];

  for (const file of files) {
    let matchedGroup = null;
    for (const group of groups) {
      const representative = group[0];
      const dist = getDistanceFromLatLonInM(file.meta.lat, file.meta.lon, representative.meta.lat, representative.meta.lon);

      // Same day AND within 100m
      if (file.meta.day === representative.meta.day && dist <= 100) {
        matchedGroup = group;
        break;
      }
    }

    if (matchedGroup) {
      matchedGroup.push(file);
    } else {
      groups.push([file]);
    }
  }

  console.log(`Created ${groups.length} groups.`);

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const paths = group.map(f => `"${f.path}"`).join(' ');
    console.log(`\n--- Processing Group ${i + 1}/${groups.length} (${group.length} images) ---`);
    try {
      // Execute the analyze_photos script for this group
      // Using inherit to see the output in real-time
      execSync(`node "${path.join(__dirname, 'analyze_photos.js')}" ${paths}`, { stdio: 'inherit' });
    } catch (err) {
      console.error(`Error processing group ${i + 1}:`, err.message);
    }
  }

  console.log("\nAll groups processed.");
}

main();
