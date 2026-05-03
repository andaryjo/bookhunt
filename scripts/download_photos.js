const fs = require('fs');
const path = require('path');

const queuePath = path.join(__dirname, '..', 'queue.json');
const photosDir = path.join(__dirname, '..', 'photos');
const token = process.env.GH_TOKEN;

async function main() {
  if (!fs.existsSync(queuePath)) {
    console.log("No queue.json found. Nothing to download.");
    return;
  }

  let queue = [];
  try {
    queue = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
  } catch (e) {
    console.error("Failed to parse queue.json", e);
    return;
  }

  if (!Array.isArray(queue) || queue.length === 0) {
    console.log("Queue is empty.");
    return;
  }

  if (!fs.existsSync(photosDir)) {
    fs.mkdirSync(photosDir, { recursive: true });
  }

  if (!token) {
    console.error("GH_TOKEN environment variable is required to download photos from private repo.");
    process.exit(1);
  }

  console.log(`Downloading ${queue.length} photos from queue...`);

  for (const url of queue) {
    const filename = path.basename(url);
    const dest = path.join(photosDir, filename);

    console.log(`Downloading ${filename}...`);
    try {
      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!res.ok) {
        console.error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
        continue;
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(dest, buffer);
    } catch (err) {
      console.error(`Error downloading ${url}:`, err.message);
    }
  }

  console.log("Downloads complete.");
}

main();
