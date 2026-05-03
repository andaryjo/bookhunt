const fs = require('fs');
const path = require('path');

const queuePath = path.join(__dirname, '..', 'queue.json');
const queueDir = path.join(__dirname, '..', 'queue');
const photosDir = path.join(__dirname, '..', 'photos');
const token = process.env.GH_TOKEN;

async function main() {
  let queue = [];

  // 1. Read from legacy queue.json
  if (fs.existsSync(queuePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
      if (Array.isArray(data)) {
        queue = queue.concat(data);
      }
    } catch (e) {
      console.error("Failed to parse queue.json", e);
    }
  }

  // 2. Read from new queue/ directory
  if (fs.existsSync(queueDir)) {
    const files = fs.readdirSync(queueDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(queueDir, file), 'utf-8'));
        // Support both single URL string or object with url property
        const url = typeof data === 'string' ? data : data.url;
        if (url) queue.push(url);
      } catch (e) {
        console.error(`Failed to parse queue/${file}`, e);
      }
    }
  }

  if (queue.length === 0) {
    console.log("Queue is empty. Nothing to download.");
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
