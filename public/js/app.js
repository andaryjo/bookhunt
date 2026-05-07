// Global State
let bookshelves = [];
let booksData = [];
let map = null;
let markers = {};
let currentFile = null;
let userLocation = { lat: 52.52, lon: 13.405 }; // Default Berlin
let isLocationShared = false;

// DOM Elements
const startPage = document.getElementById("startPage");
const mapSection = document.getElementById("mapSection");
const shelfSidebar = document.getElementById("shelfSidebar");
const mapViewBtn = document.getElementById("mapViewBtn");
const brandBtn = document.getElementById("brandBtn");
const closeShelfBtn = document.getElementById("closeShelfBtn");

const mapEl = document.getElementById("map");
const bookshelfInfo = document.getElementById("bookshelfInfo");
const shelfName = document.getElementById("shelfName");
const shelfDesc = document.getElementById("shelfDesc");
const bookList = document.getElementById("bookList");

const searchResults = document.getElementById("searchResults");
const searchList = document.getElementById("searchList");
const searchInput = document.getElementById("searchInput");
const mapSearchInput = document.getElementById("mapSearchInput");

const uploadModal = document.getElementById("uploadModal");
const openUploadBtn = document.getElementById("openUploadBtn");
const closeUploadBtn = document.getElementById("closeUploadBtn");
const bookshelfSelect = document.getElementById("bookshelfSelect");
const imageInput = document.getElementById("imageInput");
const dropZone = document.getElementById("dropZone");
const previewArea = document.getElementById("previewArea");
const imagePreview = document.getElementById("imagePreview");
const compressionStats = document.getElementById("compressionStats");
const submitBtn = document.getElementById("submitBtn");

// Initialize App
async function init() {
  console.log("Initializing app...");

  // 7. Check if location permission is already granted
  checkLocationPermission();

  // 1. Load Data FIRST
  try {
    await loadData();
    console.log(
      "Data loaded:",
      bookshelves.length,
      "shelves,",
      booksData.length,
      "books.",
    );
  } catch (e) {
    console.error("Critical error: Failed to load data", e);
    document.body.innerHTML = `<h1>Failed to load data. Please refresh.</h1><p>${e.message}</p>`;
    return;
  }

  // 2. Setup UI
  lucide.createIcons();

  // 3. Initialize Map
  try {
    map = L.map("map").setView([userLocation.lat, userLocation.lon], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    }).addTo(map);
    populateMap();
  } catch (e) {
    console.error("Map initialization failed", e);
  }

  // 4. Setup Event Listeners
  setupEventListeners();

  // 5. Initial routing
  console.log("Triggering initial routing...");
  handleRouting();

  // Handle browser navigation
  window.addEventListener("hashchange", () => {
    console.log("Hash changed, routing...");
    handleRouting();
  });
}

async function loadData() {
  const [shelvesRes, booksRes] = await Promise.all([
    fetch("data/bookshelves.json"),
    fetch("data/books.json"),
  ]);

  if (!shelvesRes.ok || !booksRes.ok) {
    throw new Error(`HTTP Error: ${shelvesRes.status} / ${booksRes.status}`);
  }

  bookshelves = await shelvesRes.json();
  booksData = (await booksRes.json()).reverse();
}

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Show 10 most recent books with geographical relevance
function showRecentBooks() {
  if (searchInput.value.trim()) return;

  if (searchResults) searchResults.classList.remove("hide-title");
  if (searchList) searchList.innerHTML = "";

  // 1. Calculate distances for all bookshelves
  const shelfDistances = {};
  bookshelves.forEach((s) => {
    shelfDistances[s.id] = getDistance(
      userLocation.lat,
      userLocation.lon,
      s.lat,
      s.lon,
    );
  });

  // 2. Separate books into "Nearby" and "Other"
  const nearbyBooks = [];
  const otherBooks = [];

  booksData.forEach((book) => {
    const distance = shelfDistances[book.bookshelfId] || Infinity;
    if (distance < 25) {
      nearbyBooks.push({ ...book, distance });
    } else {
      otherBooks.push({ ...book, distance });
    }
  });

  // 3. Sort both groups by date (newest first)
  nearbyBooks.sort((a, b) => new Date(b.date) - new Date(a.date));
  otherBooks.sort((a, b) => new Date(b.date) - new Date(a.date));

  // 4. Combine: prioritize nearby, fill with other if needed to reach 100
  let combined = [...nearbyBooks];
  if (combined.length < 100) {
    combined = combined.concat(otherBooks.slice(0, 100 - combined.length));
  } else {
    combined = combined.slice(0, 100);
  }

  renderBooks(combined, searchList, true, true);
  renderLocationPrompt(searchList);
}

function renderLocationPrompt(container) {
  if (isLocationShared) return;

  const card = document.createElement("div");
  card.className = "location-prompt-card";
  card.innerHTML = `
    <div class="text-content">
      <h4 style="font-size: 0.95rem; margin-bottom: 0.1rem;">📍 Find books near you</h4>
      <p style="font-size: 0.8rem; margin: 0; color: var(--text-muted);">Use your location for more relevant results.</p>
    </div>
    <button class="nav-btn small" style="background: var(--secondary); margin: 0; padding: 0.4rem 0.8rem; pointer-events: none;">Use location</button>
  `;
  card.addEventListener("click", requestUserLocation);

  // Insert at the 20th position (index 19) if enough items exist, else append at end
  if (container.children.length >= 18) {
    container.insertBefore(card, container.children[18]);
  } else {
    container.appendChild(card);
  }

  if (window.lucide) lucide.createIcons();
}

async function requestUserLocation() {
  if (!navigator.geolocation) {
    alert("Geolocation is not supported by your browser");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      userLocation = {
        lat: position.coords.latitude,
        lon: position.coords.longitude,
      };
      isLocationShared = true;
      console.log("User location shared:", userLocation);

      // Update map if it exists
      if (map) {
        map.setView([userLocation.lat, userLocation.lon], 13);
      }

      // Re-render current view to show better results
      const hash = window.location.hash;
      if (hash.startsWith("#/search/")) {
        const query = decodeURIComponent(hash.split("/")[2]);
        handleSearch(query, false);
      } else {
        showRecentBooks();
      }
    },
    (error) => {
      console.error("Error getting location:", error);
      let msg = "Could not get your location.";
      if (error.code === error.PERMISSION_DENIED) {
        msg =
          "Location permission denied. Please enable it in your browser settings.";
      }
      alert(msg);
    },
  );
}

async function checkLocationPermission() {
  if (!navigator.permissions || !navigator.permissions.query) return;

  try {
    const result = await navigator.permissions.query({ name: "geolocation" });
    if (result.state === "granted") {
      console.log("Location permission already granted, fetching...");
      requestUserLocation();
    }
  } catch (e) {
    console.warn("Permissions API check failed for geolocation:", e);
  }
}

// Populate map with markers
let markersLayer = null;
function populateMap(shelvesToUse = bookshelves) {
  const iconHtml = `<div class="custom-marker">📚</div>`;
  const customIcon = L.divIcon({
    html: iconHtml,
    className: "",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });

  if (markersLayer) {
    map.removeLayer(markersLayer);
  }

  markersLayer = L.markerClusterGroup({
    chunkedLoading: true,
  });

  const markerList = [];
  shelvesToUse.forEach((shelf) => {
    const marker = L.marker([shelf.lat, shelf.lon], { icon: customIcon });

    // Bind click event
    marker.on("click", () => {
      window.location.hash = `/map/shelf/${shelf.id}`;
    });

    markerList.push(marker);
    markers[shelf.id] = marker;
  });

  markersLayer.addLayers(markerList);
  map.addLayer(markersLayer);

  // Re-render icons when cluster expands/collapses or map moves
  map.on("moveend", () => {
    lucide.createIcons();
  });

  lucide.createIcons();
}

// Render Bookshelf details on the sidebar
function showBookshelfDetails(shelf, updateUrl = true) {
  if (updateUrl) {
    window.location.hash = `/map/shelf/${shelf.id}`;
  }

  shelfName.textContent = shelf.name;
  shelfDesc.textContent = shelf.address || shelf.description || "";

  // Google Maps link
  const mapsLink = document.getElementById("shelfMapsLink");
  if (mapsLink) {
    if (shelf.lat && shelf.lon) {
      mapsLink.href = `https://www.google.com/maps?q=${shelf.lat},${shelf.lon}`;
      mapsLink.style.display = "flex";
    } else {
      mapsLink.style.display = "none";
    }
  }

  // Find books for this shelf
  const targetId = String(shelf.id).toLowerCase().trim();
  const allBooks = booksData.filter(
    (book) => String(book.bookshelfId).toLowerCase().trim() === targetId,
  );

  console.log(
    `Filtering for shelf ${targetId}: found ${allBooks.length} books.`,
  );

  // Sort by newest first
  allBooks.sort((a, b) => new Date(b.date) - new Date(a.date));

  renderBooks(allBooks, bookList, false);
}

function renderShelves(shelves, container, clearContainer = true) {
  if (clearContainer) container.innerHTML = "";
  shelves.forEach((shelf) => {
    const card = document.createElement("div");
    card.className = "shelf-card";
    card.innerHTML = `
      <div class="shelf-title-row">
        <h4>📚 ${shelf.name}</h4>
      </div>
      <p class="text-muted small" style="margin: 0; margin-top: 4px;">${shelf.address || shelf.description || "Public bookshelf"}</p>
    `;
    card.addEventListener("click", () => {
      window.location.hash = `/map/shelf/${shelf.id}`;
    });
    container.appendChild(card);
  });
}

function renderBooks(
  books,
  container,
  showShelfLink = false,
  clearContainer = true,
) {
  if (clearContainer) {
    container.innerHTML = "";
  }

  if (books.length === 0) {
    if (clearContainer) {
      container.innerHTML = `
        <div class="empty-state">
          <span style="font-size: 3rem;">👻</span>
          <p>No books found here recently.</p>
        </div>
      `;
      lucide.createIcons();
    }
    return;
  }

  books.forEach((book) => {
    // Extract date directly
    const date = book.date || "Unknown";
    let shelfLinkHtml = "";

    if (showShelfLink) {
      const shelf = bookshelves.find(
        (s) => String(s.id) === String(book.bookshelfId),
      );
      if (shelf) {
        shelfLinkHtml = `<span class="book-shelf-link" data-shelf-id="${shelf.id}">${shelf.name}</span> • `;
      }
    }

    const card = document.createElement("div");
    card.className = "book-card";
    card.innerHTML = `
      <div class="book-title-row">
        <h4>${book.title || "Unknown Title"}</h4> <span class="author-text">by ${book.author || "Unknown Author"}</span>
      </div>
      <div class="book-meta">
        <span>${shelfLinkHtml}Last seen: ${date}</span>
      </div>
    `;
    container.appendChild(card);
  });

  lucide.createIcons();
  // Add event listeners for shelf links in search results
  if (showShelfLink) {
    container.querySelectorAll(".book-shelf-link").forEach((link) => {
      link.addEventListener("click", (e) => {
        const shelfId = e.target.getAttribute("data-shelf-id");
        window.location.hash = `/map/shelf/${shelfId}`;
      });
    });
  }
}

// Search Logic
async function handleSearch(query, updateUrl = true) {
  if (!query) {
    if (updateUrl) window.location.hash = "";
    showRecentBooks();
    return;
  }

  if (updateUrl) {
    window.location.hash = `/search/${encodeURIComponent(query)}`;
  }

  query = query.toLowerCase().trim();

  if (searchResults) searchResults.classList.add("hide-title");

  let searchTitle = query;

  let shelfResults = [];

  bookshelves.forEach((shelf) => {
    if (
      (shelf.name && shelf.name.toLowerCase().includes(query)) ||
      (shelf.description && shelf.description.toLowerCase().includes(query)) ||
      (shelf.address && shelf.address.toLowerCase().includes(query))
    ) {
      shelfResults.push(shelf);
    }
  });

  // Sort shelf results by proximity
  shelfResults.sort((a, b) => {
    const distA = getDistance(userLocation.lat, userLocation.lon, a.lat, a.lon);
    const distB = getDistance(userLocation.lat, userLocation.lon, b.lat, b.lon);
    return distA - distB;
  });

  let results = [];

  booksData.forEach((book) => {
    if (
      (book.title && book.title.toLowerCase().includes(searchTitle)) ||
      (book.author && book.author.toLowerCase().includes(query))
    ) {
      results.push(book);
    }
  });

  // Calculate distances for all bookshelves to sort books by proximity
  const shelfDistances = {};
  bookshelves.forEach((s) => {
    shelfDistances[s.id] = getDistance(
      userLocation.lat,
      userLocation.lon,
      s.lat,
      s.lon,
    );
  });

  // Sort results by proximity and recency
  results.sort((a, b) => {
    const distA = shelfDistances[a.bookshelfId] || Infinity;
    const distB = shelfDistances[b.bookshelfId] || Infinity;

    const aNearby = distA < 25;
    const bNearby = distB < 25;

    if (aNearby && !bNearby) return -1;
    if (!aNearby && bNearby) return 1;

    // Both nearby or both far, sort by date
    return new Date(b.date) - new Date(a.date);
  });

  searchList.innerHTML = "";

  if (shelfResults.length === 0 && results.length === 0) {
    searchList.innerHTML = `
      <div class="empty-state">
        <span style="font-size: 3rem;">👻</span>
        <p>No results found.</p>
      </div>
    `;
    renderLocationPrompt(searchList);
    lucide.createIcons();
    return;
  }

  // Unified Rendering Logic
  // 1. Render first bookshelf
  if (shelfResults.length > 0) {
    renderShelves([shelfResults[0]], searchList, false);

    // 2. Render 'Show all' button if more bookshelves exist
    if (shelfResults.length > 1) {
      const showAllCard = document.createElement("div");
      showAllCard.className = "show-all-card";
      showAllCard.innerHTML = `
        <span>Show ${shelfResults.length - 1} more bookshelves</span>
      `;
      showAllCard.onclick = () => {
        showAllCard.remove();
        // Insert the rest of the shelves at the beginning (but after the first one)
        const firstShelf = searchList.firstChild;
        const restOfShelves = shelfResults.slice(1);

        // We want them to appear before books. 
        // A simple way is to clear and re-render everything or just insert before books.
        // Let's just re-render everything for simplicity and to keep the order.
        searchList.innerHTML = "";
        renderShelves(shelfResults, searchList, false);
        renderBooks(results.slice(0, 100), searchList, true, false);
        renderLocationPrompt(searchList);
        lucide.createIcons();
      };
      searchList.appendChild(showAllCard);
    }
  }

  // 3. Render Books
  if (results.length > 0) {
    renderBooks(results.slice(0, 100), searchList, true, false);
  }

  // 4. Location prompt always at the end
  renderLocationPrompt(searchList);

  lucide.createIcons();
}

// Map-specific location search (cities, places)
async function handleMapSearch(query) {
  if (!query || query.length < 3) return;

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`,
    );
    if (res.ok) {
      const data = await res.json();
      if (data && data.length > 0) {
        const place = data[0];
        const lat = parseFloat(place.lat);
        const lon = parseFloat(place.lon);

        if (map) {
          map.setView([lat, lon], 12);
        }
      }
    }
  } catch (e) {
    console.error("Location search failed", e);
  }
}

function setupEventListeners() {
  brandBtn.addEventListener("click", () => {
    window.location.hash = "";
  });

  mapViewBtn.addEventListener("click", () => {
    window.location.hash = "/map";
  });

  closeShelfBtn.addEventListener("click", () => {
    window.location.hash = "/map";
  });

  let searchTimeout;
  searchInput.addEventListener("input", (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      handleSearch(e.target.value);
    }, 300);
  });

  let mapSearchTimeout;
  mapSearchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      handleMapSearch(e.target.value);
    }
  });
}

async function handleRouting() {
  const hash = window.location.hash;
  console.log("Routing to hash:", hash);

  // Reset body classes and visibility
  document.body.classList.remove("is-map-view", "is-shelf-view");
  mapSection.classList.add("hidden");
  mapViewBtn.classList.remove("hidden");
  shelfSidebar.classList.add("hidden");
  startPage.classList.add("hidden");

  if (hash.startsWith("#/map/shelf/")) {
    const parts = hash.split("/");
    const shelfId = parts[3];

    if (shelfId) {
      const shelf = bookshelves.find(
        (s) => String(s.id).toLowerCase() === String(shelfId).toLowerCase(),
      );
      if (shelf) {
        console.log("Found shelf:", shelf.name);
        document.body.classList.add("is-shelf-view");
        mapSection.classList.remove("hidden");
        mapViewBtn.classList.add("hidden");
        shelfSidebar.classList.remove("hidden");

        // Small delay to allow CSS display: block to take effect before invalidating
        setTimeout(() => {
          if (map) {
            map.invalidateSize();
            map.setView([shelf.lat, shelf.lon], 16);
          }
        }, 50);
        showBookshelfDetails(shelf, false);
        setTimeout(() => lucide.createIcons(), 50);
        return;
      }
    }
    // Fallback if shelf not found
    window.location.hash = "/map";
  } else if (hash === "#/map") {
    document.body.classList.add("is-map-view");
    mapSection.classList.remove("hidden");
    mapViewBtn.classList.add("hidden");

    if (map) {
      setTimeout(() => map.invalidateSize(), 100);
    }
  } else if (hash.startsWith("#/search/")) {
    startPage.classList.remove("hidden");
    const parts = hash.split("/");
    const query = parts[2] ? decodeURIComponent(parts[2]) : "";
    if (query) {
      searchInput.value = query;
      handleSearch(query, false);
    } else {
      showRecentBooks();
    }
  } else {
    // Start Page (default)
    startPage.classList.remove("hidden");
    searchInput.value = "";
    showRecentBooks();
  }

  // Ensure map size is correct if map is visible
  if (map && !mapSection.classList.contains("hidden")) {
    setTimeout(() => map.invalidateSize(), 100);
  }
}

// Start app
document.addEventListener("DOMContentLoaded", init);
