// ---------------------------------------------------------------------------
// contribute.js — photo contribution flow (no user auth)
// ---------------------------------------------------------------------------

const FUNCTION_URL =
  "https://europe-west1-goo-bookhunt.cloudfunctions.net/brutor";
const GITHUB_REPO_OWNER = "andaryjo";
const GITHUB_REPO_NAME = "bookhunt";
const MAX_SHELF_DISTANCE_KM = 0.5; // Only suggest/allow bookshelves within 500m

// ---------------------------------------------------------------------------
// State & DOM refs
// ---------------------------------------------------------------------------
let selectedFiles = []; // Array of { id, file, exifGps, compressedBlob, selectedShelfId, status }

const contributeModal = document.getElementById("contributeModal");
const openContributeBtn = document.getElementById("openContributeBtn");
const closeContributeBtn = document.getElementById("closeContributeBtn");
const contributeDropZone = document.getElementById("contributeDropZone");
const contributeImageInput = document.getElementById("contributeImageInput");
const fileQueue = document.getElementById("fileQueue");
const submitPrBtn = document.getElementById("submitPrBtn");
const prStatus = document.getElementById("prStatus");

// ---------------------------------------------------------------------------
// EXIF reading (via exifr CDN)
// ---------------------------------------------------------------------------
async function readExifGps(file) {
  try {
    if (typeof exifr === "undefined") return null;
    const gps = await exifr.gps(file);
    if (gps?.latitude && gps?.longitude)
      return { lat: gps.latitude, lon: gps.longitude };
  } catch (_) { }
  return null;
}

// ---------------------------------------------------------------------------
// Compression + EXIF strip via canvas
// ---------------------------------------------------------------------------
async function compressAndStrip(file) {
  const options = {
    maxSizeMB: 0.9,
    maxWidthOrHeight: 2048,
    useWebWorker: true,
    fileType: "image/jpeg",
    initialQuality: 0.85,
  };
  try {
    const compressed = await imageCompression(file, options);
    return await stripExifViaCanvas(compressed);
  } catch {
    return await stripExifViaCanvas(file);
  }
}

function stripExifViaCanvas(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("Canvas toBlob failed")),
        "image/jpeg",
        0.88,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image load failed"));
    };
    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// Nearest bookshelf suggestion from GPS
// ---------------------------------------------------------------------------
function suggestNearestShelf(lat, lon, radiusKm = MAX_SHELF_DISTANCE_KM) {
  if (!bookshelves?.length) return null;
  let min = Infinity,
    nearest = null;
  for (const s of bookshelves) {
    const d = getDistance(lat, lon, s.lat, s.lon);
    if (d < min) {
      min = d;
      nearest = s;
    }
  }
  return nearest && min <= radiusKm
    ? { shelf: nearest, distanceKm: min }
    : null;
}

// ---------------------------------------------------------------------------
// File queue
// ---------------------------------------------------------------------------
async function addFilesToQueue(files) {
  for (const file of files) {
    if (file.type !== "image/jpeg") {
      alert(`File "${file.name}" is not a JPEG. Only JPEG images are accepted.`);
      continue;
    }
    const entry = {
      id: Math.random().toString(36).substring(2, 8),
      file,
      exifGps: null,
      compressedBlob: null,
      selectedShelfId: null,
      status: "pending",
    };
    selectedFiles.push(entry);
    renderQueueEntry(entry);
    processEntry(entry);
  }
}

async function processEntry(entry) {
  updateEntryStatus(entry.id, "processing", "Reading EXIF & compressing…");
  try {
    entry.exifGps = await readExifGps(entry.file);
    if (!entry.exifGps) {
      throw new Error("No GPS EXIF data found. Please upload photos with location data.");
    }

    entry.compressedBlob = await compressAndStrip(entry.file);

    let suggestion = null;
    if (entry.exifGps) {
      suggestion = suggestNearestShelf(entry.exifGps.lat, entry.exifGps.lon);
      if (suggestion) entry.selectedShelfId = suggestion.shelf.id;
    }
    entry.status = "ready";
    updateEntryReady(entry, suggestion);
    updateSubmitBtn();
  } catch (err) {
    entry.status = "error";
    updateEntryStatus(entry.id, "error", `${err.message}`);
  }
}

function renderQueueEntry(entry) {
  const card = document.createElement("div");
  card.className = "queue-card";
  card.id = `queue-${entry.id}`;

  const thumb = document.createElement("img");
  thumb.className = "queue-thumb";
  thumb.src = URL.createObjectURL(entry.file);

  const info = document.createElement("div");
  info.className = "queue-info";
  info.innerHTML = `
    <div class="queue-filename">${entry.file.name}</div>
    <div class="queue-status-text" id="qs-${entry.id}">Queued…</div>`;

  const removeBtn = document.createElement("button");
  removeBtn.className = "queue-remove";
  removeBtn.innerHTML = "✕";
  removeBtn.title = "Remove";
  removeBtn.onclick = () => removeEntry(entry.id);

  card.appendChild(thumb);
  card.appendChild(info);
  card.appendChild(removeBtn);
  fileQueue.appendChild(card);
}

function updateEntryStatus(id, cls, text) {
  const el = document.getElementById(`qs-${id}`);
  if (el) {
    el.textContent = text;
    el.className = `queue-status-text ${cls}`;
  }
}

function updateEntryReady(entry, suggestion) {
  const el = document.getElementById(`qs-${entry.id}`);
  if (!el) return;
  const sizeKb = entry.compressedBlob
    ? Math.round(entry.compressedBlob.size / 1024)
    : "?";

  let shelfPickerHtml = "";
  if (bookshelves?.length) {
    const nearbyOptions = entry.exifGps
      ? bookshelves
        .map((s) => ({
          ...s,
          dist: getDistance(
            entry.exifGps.lat,
            entry.exifGps.lon,
            s.lat,
            s.lon,
          ),
        }))
        .filter((s) => s.dist <= MAX_SHELF_DISTANCE_KM) // Only within valid range
        .sort((a, b) => a.dist - b.dist)
        .map((s) => {
          const d =
            s.dist < 1
              ? `${Math.round(s.dist * 1000)}m`
              : `${s.dist.toFixed(1)}km`;
          return `<option value="${s.id}" ${s.id === entry.selectedShelfId ? "selected" : ""}>${s.name} (${d})</option>`;
        })
      : [];

    shelfPickerHtml = `
      <select class="queue-shelf-select" id="shelf-${entry.id}">
        <option value="">— No bookshelf found —</option>
        ${nearbyOptions.join("")}
      </select>`;
  }

  el.innerHTML = `
    <span class="ready">✓ Ready · ${sizeKb} KB${entry.exifGps ? " · GPS found" : " · No GPS"}</span>
    ${shelfPickerHtml}`;

  const select = document.getElementById(`shelf-${entry.id}`);
  if (select) {
    select.addEventListener("change", (e) => {
      entry.selectedShelfId = e.target.value || null;
    });
  }
}

function removeEntry(id) {
  selectedFiles = selectedFiles.filter((e) => e.id !== id);
  document.getElementById(`queue-${id}`)?.remove();
  updateSubmitBtn();
}

function updateSubmitBtn() {
  submitPrBtn.disabled =
    selectedFiles.filter((e) => e.status === "ready").length === 0;
}

// Search functionality removed per optimization request.

async function submitPhotos() {
  const readyEntries = selectedFiles.filter(
    (e) => e.status === "ready" && e.compressedBlob,
  );
  if (!readyEntries.length) return;

  submitPrBtn.disabled = true;
  setPrStatus("Uploading photos…", "info");

  try {
    const photos = await Promise.all(
      readyEntries.map(async (entry) => ({
        data: await blobToBase64(entry.compressedBlob),
        shelfId: entry.selectedShelfId || null,
        lat: entry.exifGps?.lat ?? null,
        lon: entry.exifGps?.lon ?? null,
      })),
    );

    const res = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photos }),
    });

    const data = await res.json();

    if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);

    setPrStatus(
      `🎉 Your contribution has been submitted and is pending review. You can view its status <a href="${data.prUrl}" target="_blank" rel="noopener">here</a> — thank you!`,
      "success",
    );

    selectedFiles = [];
    fileQueue.innerHTML = "";
    submitPrBtn.disabled = true;
  } catch (err) {
    console.error(err);
    setPrStatus(`Error: ${err.message}`, "error");
    submitPrBtn.disabled = false;
  }
}

function setPrStatus(html, type) {
  prStatus.innerHTML = html;
  prStatus.className = `pr-status ${type}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
function initContribute() {
  // Modal open/close
  openContributeBtn?.addEventListener("click", () => {
    contributeModal?.classList.remove("hidden");
    prStatus.textContent = "";
    prStatus.className = "pr-status";
  });

  closeContributeBtn?.addEventListener("click", () =>
    contributeModal?.classList.add("hidden"),
  );

  contributeModal?.addEventListener("click", (e) => {
    if (e.target === contributeModal) contributeModal.classList.add("hidden");
  });

  // Drop zone
  contributeDropZone.addEventListener("click", () =>
    contributeImageInput.click(),
  );

  contributeDropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    contributeDropZone.classList.add("dragover");
  });
  contributeDropZone.addEventListener("dragleave", () =>
    contributeDropZone.classList.remove("dragover"),
  );
  contributeDropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    contributeDropZone.classList.remove("dragover");
    addFilesToQueue([...e.dataTransfer.files]);
  });

  contributeImageInput.addEventListener("change", (e) => {
    addFilesToQueue([...e.target.files]);
    contributeImageInput.value = "";
  });

  // Submit
  submitPrBtn.addEventListener("click", submitPhotos);

  // Search functionality removed.
}

window.initContribute = initContribute;
