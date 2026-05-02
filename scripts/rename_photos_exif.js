const fs = require('fs');
const path = require('path');
const exifr = require('exifr');

const rawDir = path.join(__dirname, '..', 'raw');

async function main() {
  if (!fs.existsSync(rawDir)) {
    console.error(`Directory not found: ${rawDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(rawDir);

  for (const file of files) {
    if (!file.toLowerCase().endsWith('.jpg') && !file.toLowerCase().endsWith('.jpeg')) {
      continue;
    }

    const filePath = path.join(rawDir, file);
    
    try {
      // Parse the EXIF data
      const data = await exifr.parse(filePath);
      
      if (!data) {
        console.log(`Skipping ${file} - No EXIF data found.`);
        continue;
      }

      const date = data.DateTimeOriginal || data.CreateDate || data.ModifyDate;
      const lat = data.latitude;
      const lon = data.longitude;

      if (!date || lat === undefined || lon === undefined) {
        console.log(`Skipping ${file} - Missing required EXIF data (date, lat, or lon).`);
        continue;
      }

      // Format date: YYYYMMDD_HHMMSS
      const d = new Date(date);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      
      const dateStr = `${yyyy}${mm}${dd}_${hh}${min}${ss}`;
      
      // Format coordinates: 52.5200_13.4050
      const latStr = lat.toFixed(6);
      const lonStr = lon.toFixed(6);

      const ext = path.extname(file);
      const newFileName = `${dateStr}_${latStr}_${lonStr}${ext}`;
      const newFilePath = path.join(rawDir, newFileName);

      if (filePath !== newFilePath) {
        fs.renameSync(filePath, newFilePath);
        console.log(`Renamed: ${file} -> ${newFileName}`);
      } else {
        console.log(`Skipped: ${file} (already correctly named)`);
      }
      
    } catch (err) {
      console.error(`Error processing ${file}:`, err.message);
    }
  }
  console.log("Done.");
}

main();
