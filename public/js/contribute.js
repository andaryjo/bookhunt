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
let targetShelf = null; // Pre-selected shelf from query parameter
let userLocation = null; // Cached device geolocation { lat, lon }
let searchModalEntryId = null; // Which entry triggered the search modal

const contributeModal = document.getElementById("contributeModal");
const openContributeBtn = document.getElementById("openContributeBtn");
const closeContributeBtn = document.getElementById("closeContributeBtn");
const contributeDropZone = document.getElementById("contributeDropZone");
const contributeImageInput = document.getElementById("contributeImageInput");
const fileQueue = document.getElementById("fileQueue");
const submitPrBtn = document.getElementById("submitPrBtn");
const prStatus = document.getElementById("prStatus");

// Search modal refs
const shelfSearchModal = document.getElementById("shelfSearchModal");
const closeSearchModalBtn = document.getElementById("closeSearchModalBtn");
const modalSearchInput = document.getElementById("modalSearchInput");
const modalSearchList = document.getElementById("modalSearchList");

// ---------------------------------------------------------------------------
// EXIF reading (via exifr CDN)
// ---------------------------------------------------------------------------
async function readExifGps(file) {
  try {
    if (typeof exifr === "undefined") return null;

    // 1. Get GPS (most critical)
    const gps = await exifr.gps(file);

    // 2. Try to get date separately
    let date = null;
    try {
      const meta = await exifr.parse(file);
      date = meta?.DateTimeOriginal || meta?.CreateDate || meta?.ModifyDate;
    } catch (e) {
      console.warn("Could not parse date EXIF", e);
    }

    if (!date) {
      date = file.lastModified ? new Date(file.lastModified) : new Date();
    }

    if (gps?.latitude && gps?.longitude) {
      return { lat: gps.latitude, lon: gps.longitude, date: date };
    } else {
      console.warn("No GPS data found in EXIF", gps);
    }
  } catch (err) {
    console.error("Error reading EXIF:", err);
  }
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
      alert(
        `File "${file.name}" is not a JPEG. Only JPEG images are accepted.`,
      );
      continue;
    }
    const entry = {
      id: randomId(6),
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
    entry.compressedBlob = await compressAndStrip(entry.file);

    // Propose the bookshelf
    if (entry.exifGps) {
      // Priority 1: EXIF GPS -> nearest shelf
      const suggestion = suggestNearestShelf(
        entry.exifGps.lat,
        entry.exifGps.lon,
      );
      if (suggestion) {
        entry.selectedShelfId = suggestion.shelf.id;
      }
    }

    // Priority 2: Linked shelfId from contribution button (targetShelf)
    if (!entry.selectedShelfId && targetShelf) {
      entry.selectedShelfId = targetShelf.id;
    }

    // Priority 3: Browser location -> nearest shelf
    if (!entry.selectedShelfId && userLocation) {
      const suggestion = suggestNearestShelf(
        userLocation.lat,
        userLocation.lon,
      );
      if (suggestion) {
        entry.selectedShelfId = suggestion.shelf.id;
      }
    }

    entry.status = "ready";
    updateEntryReady(entry);
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

function updateEntryReady(entry) {
  const el = document.getElementById(`qs-${entry.id}`);
  if (!el) return;
  const sizeKb = entry.compressedBlob
    ? Math.round(entry.compressedBlob.size / 1024)
    : "?";

  let gpsText = "";
  let gpsClass = "";
  if (entry.exifGps) {
    gpsText = "EXIF location found";
    gpsClass = "ready";
  } else if (userLocation) {
    gpsText = "User location found";
    gpsClass = "ready";
  } else {
    gpsText = "No Location";
    gpsClass = "warning-yellow";
  }

  const statusHtml = `<div class="queue-status-line"><span class="${gpsClass}">✓ Ready · ${sizeKb} KB · ${gpsText}</span></div>`;

  const assignedShelf = entry.selectedShelfId
    ? bookshelves.find((s) => s.id === entry.selectedShelfId)
    : null;

  let shelfText = "";
  let shelfClass = "";
  if (assignedShelf) {
    let distanceText = "";
    let dist = null;
    if (entry.exifGps) {
      dist = getDistance(
        entry.exifGps.lat,
        entry.exifGps.lon,
        assignedShelf.lat,
        assignedShelf.lon,
      );
    } else if (userLocation) {
      dist = getDistance(
        userLocation.lat,
        userLocation.lon,
        assignedShelf.lat,
        assignedShelf.lon,
      );
    }

    if (dist !== null) {
      const d =
        dist < 1 ? `${Math.round(dist * 1000)}m` : `${dist.toFixed(1)}km`;
      distanceText = ` (${d} away)`;
    }

    shelfText = `${escapeHtml(assignedShelf.name)}${distanceText} ✎`;
    shelfClass = "shelf-link-assigned";
  } else {
    shelfText = "no shelf found ✎";
    shelfClass = "shelf-link-missing";
  }

  const shelfLineHtml = `
    <div class="queue-shelf-line" style="margin-top: 0.3rem; font-size: 0.85rem; color: var(--text-muted);">
      Selected bookshelf: <span class="shelf-selection-trigger ${shelfClass}" id="trigger-${entry.id}">${shelfText}</span>
    </div>
  `;

  el.innerHTML = `${statusHtml}${shelfLineHtml}`;

  // Bind the click event to open the selection modal
  const trigger = document.getElementById(`trigger-${entry.id}`);
  if (trigger) {
    trigger.addEventListener("click", () => {
      openSearchModal(entry.id);
    });
  }
}

function removeEntry(id) {
  selectedFiles = selectedFiles.filter((e) => e.id !== id);
  document.getElementById(`queue-${id}`)?.remove();
  updateSubmitBtn();
}

function updateSubmitBtn() {
  // Every ready entry must have either EXIF GPS or a selected shelf
  const readyEntries = selectedFiles.filter((e) => e.status === "ready");
  if (readyEntries.length === 0) {
    submitPrBtn.disabled = true;
    return;
  }
  const allHaveLocation = readyEntries.every(
    (e) => e.exifGps !== null || e.selectedShelfId,
  );
  submitPrBtn.disabled = !allHaveLocation;
}

// ---------------------------------------------------------------------------
// Search Modal
// ---------------------------------------------------------------------------
let searchDebounceTimer = null;

function showDefaultModalContent() {
  const entry = selectedFiles.find((e) => e.id === searchModalEntryId);
  const referenceLoc = entry?.exifGps || userLocation;

  if (referenceLoc && bookshelves?.length) {
    const nearby = bookshelves
      .map((s) => ({
        s,
        dist: getDistance(referenceLoc.lat, referenceLoc.lon, s.lat, s.lon),
      }))
      .filter((item) => item.dist <= MAX_SHELF_DISTANCE_KM)
      .sort((a, b) => a.dist - b.dist);

    if (nearby.length > 0) {
      modalSearchList.innerHTML =
        `
        <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.5rem; font-weight: 500; text-align: left; padding: 0 0.25rem;">
          Nearby bookshelves:
        </div>
        ` +
        nearby
          .map(({ s, dist }) => {
            const addr = s.address || s.description || "";
            const d =
              dist < 1 ? `${Math.round(dist * 1000)}m` : `${dist.toFixed(1)}km`;
            return `
          <div class="shelf-search-row" data-shelf-id="${s.id}">
            <div class="shelf-search-row-title">${escapeHtml(s.name)} <span style="font-size: 0.75rem; color: var(--secondary); font-weight: normal;">(${d} away)</span></div>
            ${addr ? `<div class="shelf-search-row-address">${escapeHtml(addr)}</div>` : '<div class="shelf-search-row-address" style="margin-bottom:0.4rem;"></div>'}
            <div class="shelf-search-row-actions">
              <button type="button" class="shelf-search-btn" data-action="one" data-shelf-id="${s.id}">Use for this photo</button>
              <button type="button" class="shelf-search-btn all-btn" data-action="all" data-shelf-id="${s.id}">Use for all photos</button>
            </div>
          </div>`;
          })
          .join("");

      // Bind action buttons
      modalSearchList.querySelectorAll(".shelf-search-btn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const shelfId = btn.getAttribute("data-shelf-id");
          const action = btn.getAttribute("data-action");
          applyShelfFromSearch(shelfId, action);
        });
      });
      return;
    }
  }

  modalSearchList.innerHTML = `<div style="color: var(--text-muted); font-size: 0.85rem; text-align: center; padding: 1rem;">Type to search…</div>`;
}

function openSearchModal(entryId) {
  searchModalEntryId = entryId;
  shelfSearchModal.classList.remove("hidden");
  modalSearchInput.value = "";
  showDefaultModalContent();
  setTimeout(() => modalSearchInput.focus(), 100);
}

function closeSearchModal() {
  shelfSearchModal.classList.add("hidden");
  searchModalEntryId = null;
  modalSearchInput.value = "";
  modalSearchList.innerHTML = "";
}

function performShelfSearch(query) {
  if (!query || query.trim().length === 0) {
    showDefaultModalContent();
    return;
  }

  if (query.trim().length < 2) {
    modalSearchList.innerHTML = `<div style="color: var(--text-muted); font-size: 0.85rem; text-align: center; padding: 1rem;">Type at least 2 characters…</div>`;
    return;
  }

  const q = query.toLowerCase().trim();

  // Score and filter bookshelves
  const scored = [];
  for (const shelf of bookshelves) {
    const name = (shelf.name || "").toLowerCase();
    const address = (shelf.address || shelf.description || "").toLowerCase();
    let score = 0;

    if (name.startsWith(q)) score = 100;
    else if (name.includes(q)) score = 60;
    else if (address.includes(q)) score = 30;
    else continue;

    // Bonus for proximity if user location is known
    if (userLocation) {
      const dist = getDistance(
        userLocation.lat,
        userLocation.lon,
        shelf.lat,
        shelf.lon,
      );
      score += Math.max(0, 20 - dist); // Closer = higher bonus
    }

    scored.push({ shelf, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const results = scored.slice(0, 50);

  if (results.length === 0) {
    modalSearchList.innerHTML = `<div style="color: var(--text-muted); font-size: 0.85rem; text-align: center; padding: 1rem;">No bookshelves found.</div>`;
    return;
  }

  modalSearchList.innerHTML = results
    .map(({ shelf }) => {
      const addr = shelf.address || shelf.description || "";
      return `
      <div class="shelf-search-row" data-shelf-id="${shelf.id}">
        <div class="shelf-search-row-title">${escapeHtml(shelf.name)}</div>
        ${addr ? `<div class="shelf-search-row-address">${escapeHtml(addr)}</div>` : '<div class="shelf-search-row-address" style="margin-bottom:0.4rem;"></div>'}
        <div class="shelf-search-row-actions">
          <button type="button" class="shelf-search-btn" data-action="one" data-shelf-id="${shelf.id}">Use for this photo</button>
          <button type="button" class="shelf-search-btn all-btn" data-action="all" data-shelf-id="${shelf.id}">Use for all photos</button>
        </div>
      </div>`;
    })
    .join("");

  // Bind action buttons
  modalSearchList.querySelectorAll(".shelf-search-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const shelfId = btn.getAttribute("data-shelf-id");
      const action = btn.getAttribute("data-action");
      applyShelfFromSearch(shelfId, action);
    });
  });
}

function applyShelfFromSearch(shelfId, action) {
  if (action === "one") {
    // Apply to the entry that opened the modal
    const entry = selectedFiles.find((e) => e.id === searchModalEntryId);
    if (entry) {
      entry.selectedShelfId = shelfId;
      updateEntryReady(entry);
    }
  } else if (action === "all") {
    // Apply to all ready entries
    selectedFiles.forEach((entry) => {
      if (entry.status === "ready") {
        entry.selectedShelfId = shelfId;
        updateEntryReady(entry);
      }
    });
  }
  updateSubmitBtn();
  closeSearchModal();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------
async function submitPhotos() {
  const readyEntries = selectedFiles.filter(
    (e) => e.status === "ready" && e.compressedBlob,
  );
  if (!readyEntries.length) return;

  submitPrBtn.disabled = true;
  setPrStatus("Uploading photos…", "info");

  try {
    const photos = await Promise.all(
      readyEntries.map(async (entry) => {
        return {
          data: await blobToBase64(entry.compressedBlob),
          shelfId: entry.selectedShelfId || null,
          date: formatDate(entry.exifGps?.date),
          id: entry.id,
        };
      }),
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

function formatDate(d) {
  try {
    const date = new Date(d || Date.now());
    if (isNaN(date.getTime())) return new Date().toISOString().split("T")[0];
    return date.toISOString().split("T")[0];
  } catch (e) {
    return new Date().toISOString().split("T")[0];
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomId(length) {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
function initContribute() {
  const isAndroid = /Android/i.test(navigator.userAgent);

  // --- Load cached location ---
  try {
    const cached = localStorage.getItem("user-location");
    if (cached) {
      userLocation = JSON.parse(cached);
      console.log("Loaded cached location:", userLocation);
    }
  } catch (e) {
    console.warn("Failed to load cached location", e);
  }

  // --- Parse ?shelfId= query parameter ---
  const urlParams = new URLSearchParams(window.location.search);
  const shelfIdParam = urlParams.get("shelfId");
  if (shelfIdParam && bookshelves?.length) {
    const found = bookshelves.find((g) =>
      g.memberIds
        ? g.memberIds.some(
            (id) => String(id).toLowerCase() === shelfIdParam.toLowerCase(),
          )
        : String(g.id).toLowerCase() === shelfIdParam.toLowerCase(),
    );
    if (found) {
      targetShelf = found;
    }
  }

  // --- Android: show location prompt and remove accept filter ---
  if (isAndroid) {
    if (contributeImageInput) {
      contributeImageInput.removeAttribute("accept");
    }
    const androidPrompt = document.getElementById("androidLocationPrompt");
    if (androidPrompt) {
      androidPrompt.classList.remove("hidden");
    }

    const enableGpsBtn = document.getElementById("enableAndroidGpsBtn");
    if (enableGpsBtn) {
      if (userLocation) {
        enableGpsBtn.disabled = true;
        enableGpsBtn.textContent = "✓ Location found";
        enableGpsBtn.style.borderColor = "rgba(74, 222, 128, 0.4)";
        enableGpsBtn.style.color = "#4ade80";
        enableGpsBtn.style.background = "rgba(74, 222, 128, 0.1)";
      }

      enableGpsBtn.addEventListener("click", () => {
        enableGpsBtn.disabled = true;
        enableGpsBtn.textContent = "Requesting location…";
        navigator.geolocation.getCurrentPosition(
          (position) => {
            userLocation = {
              lat: position.coords.latitude,
              lon: position.coords.longitude,
            };
            enableGpsBtn.textContent = "✓ Location found";
            enableGpsBtn.style.borderColor = "rgba(74, 222, 128, 0.4)";
            enableGpsBtn.style.color = "#4ade80";
            enableGpsBtn.style.background = "rgba(74, 222, 128, 0.1)";
            console.log("User location cached:", userLocation);
            // Cache it in localStorage as well
            localStorage.setItem("user-location", JSON.stringify(userLocation));
          },
          (error) => {
            enableGpsBtn.disabled = false;
            enableGpsBtn.textContent = "Use location";
            alert(`Could not get location: ${error.message}`);
          },
          { enableHighAccuracy: true, timeout: 15000 },
        );
      });
    }
  }

  // --- Search modal ---
  closeSearchModalBtn?.addEventListener("click", closeSearchModal);
  shelfSearchModal?.addEventListener("click", (e) => {
    if (e.target === shelfSearchModal) closeSearchModal();
  });

  modalSearchInput?.addEventListener("input", (e) => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      performShelfSearch(e.target.value);
    }, 250);
  });

  // --- Modal open/close (for main page modal, if present) ---
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

  // --- Drop zone ---
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

  // --- Submit ---
  submitPrBtn.addEventListener("click", submitPhotos);
}

window.initContribute = initContribute;
