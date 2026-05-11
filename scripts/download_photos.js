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
    const files = fs.readdirSync(queueDir).filter(f => f !== '.gitkeep');
    for (const file of files) {
      try {
        const filePath = path.join(queueDir, file);
        const content = fs.readFileSync(filePath, 'utf-8').trim();
        if (!content) continue;

        try {
          const data = JSON.parse(content);
          if (Array.isArray(data)) {
            // Legacy format or bulk
            queue = queue.concat(data.map(item => typeof item === 'string' ? { url: item } : item));
          } else {
            const url = typeof data === 'string' ? data : data.url;
            if (url) {
              queue.push(typeof data === 'string' ? { url: data } : data);
            }
          }
        } catch (e) {
          // Not JSON, treat as raw URL
          queue.push({ url: content });
        }
      } catch (e) {
        console.error(`Failed to read queue/${file}`, e);
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

  for (const item of queue) {
    const url = item.url;
    if (!url) continue;

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
