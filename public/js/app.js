// Global State
let bookshelves = [];
let booksData = [];
let map = null;
let markers = {};
let currentFile = null;
let userLocation = { lat: 52.52, lon: 13.405 }; // Default Berlin
let isLocationShared = false;
let shelfIdToGroup = {}; // Map for fast lookup
const BOOKS_PER_PAGE = 200;
let currentStartPageLimit = BOOKS_PER_PAGE;
let currentSearchResultsLimit = BOOKS_PER_PAGE;
let currentShelfDetailsLimit = BOOKS_PER_PAGE;
let startPageBooks = [];
let searchResultsBooks = [];
let shelfDetailsBooks = [];
let currentShelf = null;

// Load cached location if available
try {
  const cached = localStorage.getItem("user-location");
  if (cached) {
    userLocation = JSON.parse(cached);
    isLocationShared = true;
    console.log("Loaded cached location:", userLocation);
  }
} catch (e) {
  console.warn("Failed to load cached location", e);
}
let isDataLoaded = false;

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
const loadingOverlay = document.getElementById("loadingOverlay");
const startPageSummary = document.getElementById("startPageSummary");
const searchLoadMoreContainer = document.getElementById(
  "searchLoadMoreContainer",
);
const searchLoadMoreBtn = document.getElementById("searchLoadMoreBtn");
const shelfLoadMoreContainer = document.getElementById(
  "shelfLoadMoreContainer",
);
const shelfLoadMoreBtn = document.getElementById("shelfLoadMoreBtn");

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
  if (loadingOverlay) loadingOverlay.classList.remove("hidden");
  try {
    await loadData();
    if (loadingOverlay) loadingOverlay.classList.add("hidden");
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
      attribution:
        '© OpenStreetMap | <a href="https://github.com/andaryjo/bookhunt#data" target="_blank">Bookshelf data sources</a>',
    }).addTo(map);

    // Defer populating map markers to keep startup fast
    setTimeout(() => {
      console.log("Populating map markers in background...");
      populateMap();
    }, 100);
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

async function loadData(forceNetwork = false) {
  const CACHE_NAME = "bookhunt-data-v1";
  const LAST_UPDATE_KEY = "last-data-update";
  const now = Date.now();
  const sixHours = 6 * 60 * 60 * 1000;
  const lastUpdate = localStorage.getItem(LAST_UPDATE_KEY);
  const isCacheValid = !forceNetwork && lastUpdate && now - parseInt(lastUpdate) < sixHours;

  async function fetchWithCache(url) {
    if (window.caches && isCacheValid) {
      try {
        const cache = await caches.open(CACHE_NAME);
        const cachedResponse = await cache.match(url);
        if (cachedResponse) {
          console.log(`[Cache] Loading ${url}`);
          return cachedResponse.json();
        }
      } catch (e) {
        console.warn("Cache access failed", e);
      }
    }

    console.log(`[Network] Fetching ${url}`);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP Error: ${res.status} for ${url}`);
      const data = await res.json();

      if (window.caches) {
        try {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(url, new Response(JSON.stringify(data)));
        } catch (e) {
          console.warn("Failed to update cache", e);
        }
      }
      return data;
    } catch (fetchError) {
      console.warn(`[Network] Fetch failed for ${url}. Trying cache fallback...`, fetchError);
      
      if (window.caches) {
        try {
          const cache = await caches.open(CACHE_NAME);
          const cachedResponse = await cache.match(url);
          if (cachedResponse) {
            console.log(`[Cache Fallback] Loaded cached copy of ${url} due to offline state`);
            return cachedResponse.json();
          }
        } catch (cacheError) {
          console.error("Cache access failed during offline fallback", cacheError);
        }
      }
      throw fetchError;
    }
  }

  const [manifest, allBooks] = await Promise.all([
    fetchWithCache("data/bookshelves/manifest.json"),
    fetchWithCache("data/books.json"),
  ]);

  // Load all bookshelf files dynamically from the manifest
  const shelfPromises = manifest.map((file) =>
    fetchWithCache(`data/bookshelves/${file}`),
  );

  const shelfArrays = await Promise.all(shelfPromises);
  const allShelves = shelfArrays.flat();

  // Filter removed bookshelves in one pass
  const activeShelves = [];
  const removedShelfIds = new Set();
  allShelves.forEach((s) => {
    if (s.removed === true) {
      removedShelfIds.add(String(s.id));
    } else {
      activeShelves.push(s);
    }
  });

  bookshelves = clusterBookshelves(activeShelves);

  // Build lookup map for fast access
  shelfIdToGroup = {};
  bookshelves.forEach((group) => {
    group.memberIds.forEach((id) => {
      shelfIdToGroup[id] = group;
    });
  });

  // Filter books from removed bookshelves
  booksData = allBooks
    .reverse()
    .filter((b) => !removedShelfIds.has(String(b.bookshelfId)));

  if (!isCacheValid) {
    localStorage.setItem(LAST_UPDATE_KEY, now.toString());
  }

  isDataLoaded = true;
}

function getBookWeight(book, shelfDistances, now) {
  const bookDate = new Date(book.date || "2000-01-01");
  const diffDays = (now - bookDate) / (1000 * 60 * 60 * 24);

  // Find the group distance for this book's shelfId
  let distance = 0;
  if (isLocationShared) {
    const shelfId = String(book.bookshelfId);
    const group = shelfIdToGroup[shelfId];
    distance = group ? shelfDistances[group.id] || 1000 : 1000;
  }

  return diffDays + distance;
}

// Show books sorted by weighted relevance (recency + distance)
function showRecentBooks() {
  if (!isDataLoaded) return;
  if (searchInput.value.trim()) return;

  if (searchResults) searchResults.classList.remove("hide-title");
  if (searchList) searchList.innerHTML = "";

  if (startPageSummary) {
    startPageSummary.innerHTML = `Discover <strong>${booksData.length}</strong> free books in <strong>${bookshelves.length}</strong> public bookshelves`;
    startPageSummary.classList.remove("hidden");
  }

  const now = new Date();

  // 1. Calculate distances ONLY if location is shared AND only for shelves with books
  const shelfDistances = {};
  if (isLocationShared) {
    const relevantShelfIds = new Set(
      booksData.map((b) => String(b.bookshelfId)),
    );
    bookshelves.forEach((group) => {
      // Check if any member of this group has books
      const hasBooks = group.memberIds.some((id) => relevantShelfIds.has(id));
      if (hasBooks) {
        shelfDistances[group.id] = getDistance(
          userLocation.lat,
          userLocation.lon,
          group.lat,
          group.lon,
        );
      }
    });
  }

  // 2. Sort all books by weight
  startPageBooks = [...booksData].sort((a, b) => {
    return (
      getBookWeight(a, shelfDistances, now) -
      getBookWeight(b, shelfDistances, now)
    );
  });

  currentStartPageLimit = BOOKS_PER_PAGE;
  renderStartPage();
}

function renderStartPage() {
  if (searchResults) searchResults.classList.remove("hide-title");

  const booksToShow = startPageBooks.slice(0, currentStartPageLimit);
  renderBooks(booksToShow, searchList, true, true);
  renderLocationPrompt(searchList);

  if (currentStartPageLimit < startPageBooks.length) {
    searchLoadMoreContainer.classList.remove("hidden");
  } else {
    searchLoadMoreContainer.classList.add("hidden");
  }
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
  card.addEventListener("click", () => requestUserLocation());

  // Insert at the 6th if enough items exist, else append at end
  if (container.children.length >= 5) {
    container.insertBefore(card, container.children[5]);
  } else {
    container.appendChild(card);
  }

  if (window.lucide) lucide.createIcons();
}

async function requestUserLocation(silent = false) {
  if (!navigator.geolocation) {
    if (silent !== true) alert("Geolocation is not supported by your browser");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      userLocation = {
        lat: position.coords.latitude,
        lon: position.coords.longitude,
      };
      isLocationShared = true;
      localStorage.setItem("user-location", JSON.stringify(userLocation));
      console.log("User location shared and cached:", userLocation);

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
      if (silent === true) return;

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
      console.log(
        "Location permission already granted, fetching in background...",
      );
      requestUserLocation(true);
    } else if (result.state === "denied") {
      // If denied, we should probably not pretend it's shared even if we have a cache?
      // Actually, let's keep the cache if it's already there, but maybe the prompt should reappear?
      // For now, let's just stay silent.
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
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });

  if (markersLayer) {
    map.removeLayer(markersLayer);
  }

  markersLayer = L.markerClusterGroup({
    chunkedLoading: true,
    iconCreateFunction: function (cluster) {
      const count = cluster.getChildCount();
      return L.divIcon({
        html: `<div class="custom-cluster-icon"><span>${count}</span></div>`,
        className: "",
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      });
    },
  });

  const markerList = [];
  shelvesToUse.forEach((shelf) => {
    const marker = L.marker([shelf.lat, shelf.lon], { icon: customIcon });

    // Bind click event
    marker.on("click", () => {
      window.location.hash = `/shelf/${shelf.id}`;
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
function showBookshelfDetails(shelf, updateUrl = true, requestedId = null) {
  if (shelf.memberIds && shelf.memberIds.length > 1) {
    console.log(`Duplicate shelf IDs for "${shelf.name}":`, shelf.memberIds);
  }

  if (updateUrl) {
    window.location.hash = `/shelf/${requestedId || shelf.id}`;
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

  // Find books for all shelves in this group
  const memberIds = new Set(
    shelf.memberIds.map((id) => String(id).toLowerCase().trim()),
  );
  shelfDetailsBooks = booksData.filter((book) =>
    memberIds.has(String(book.bookshelfId).toLowerCase().trim()),
  );

  console.log(
    `Filtering for shelf group ${shelf.id}: found ${shelfDetailsBooks.length} books.`,
  );

  // Sort by newest first
  shelfDetailsBooks.sort((a, b) => new Date(b.date) - new Date(a.date));

  currentShelf = shelf;
  currentShelfDetailsLimit = BOOKS_PER_PAGE;
  renderShelfDetails();
}

function renderShelfDetails() {
  const booksToShow = shelfDetailsBooks.slice(0, currentShelfDetailsLimit);
  renderBooks(booksToShow, bookList, false);

  if (currentShelfDetailsLimit < shelfDetailsBooks.length) {
    shelfLoadMoreContainer.classList.remove("hidden");
  } else {
    shelfLoadMoreContainer.classList.add("hidden");
  }
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
      window.location.hash = `/shelf/${shelf.id}`;
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
          <p>No books have been seen here recently.</p>
        </div>
      `;
      lucide.createIcons();
    }
    return;
  }

  books.forEach((book) => {
    // Format relative last seen text
    const lastSeenText = formatDaysAgo(book.date);
    let shelfLinkHtml = "";

    if (showShelfLink) {
      const shelf = shelfIdToGroup[String(book.bookshelfId)];
      if (shelf) {
        shelfLinkHtml = `<span class="book-shelf-link" data-shelf-id="${book.bookshelfId}">${shelf.name}</span> • `;
      }
    }

    const card = document.createElement("div");
    card.className = "book-card";
    card.innerHTML = `
      <div class="book-title-row">
        <h4>${book.title || "Unknown Title"}</h4> <span class="author-text">${book.author || "Unknown Author"}</span>
      </div>
      <div class="book-meta">
        <span>${shelfLinkHtml}Last seen ${lastSeenText}</span>
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
        window.location.hash = `/shelf/${shelfId}`;
      });
    });
  }
}

// Search Logic
async function handleSearch(query, updateUrl = true) {
  if (!isDataLoaded) return;
  if (!query) {
    if (updateUrl) window.location.hash = "";
    showRecentBooks();
    return;
  }

  if (updateUrl) {
    window.location.hash = `/search/${encodeURIComponent(query)}`;
  }

  query = query.toLowerCase().trim();

  if (startPageSummary) startPageSummary.classList.add("hidden");
  if (searchResults) searchResults.classList.add("hide-title");

  let searchTitle = query;

  let results = [];

  booksData.forEach((book) => {
    if (
      (book.title && book.title.toLowerCase().includes(searchTitle)) ||
      (book.author && book.author.toLowerCase().includes(query))
    ) {
      results.push(book);
    }
  });

  // 2. Calculate distances ONLY if location is shared AND only for shelves referenced by result books
  const shelfDistances = {};
  if (isLocationShared) {
    const resultShelfIds = new Set(results.map((b) => String(b.bookshelfId)));
    bookshelves.forEach((group) => {
      const hasResults = group.memberIds.some((id) => resultShelfIds.has(id));
      if (hasResults) {
        shelfDistances[group.id] = getDistance(
          userLocation.lat,
          userLocation.lon,
          group.lat,
          group.lon,
        );
      }
    });
  }

  // Sort results by weighted relevance (recency + distance)
  const now = new Date();
  results.sort((a, b) => {
    return (
      getBookWeight(a, shelfDistances, now) -
      getBookWeight(b, shelfDistances, now)
    );
  });

  searchResultsBooks = results;
  currentSearchResultsLimit = BOOKS_PER_PAGE;
  renderSearchResults();
}

function renderSearchResults() {
  searchList.innerHTML = "";

  if (searchResultsBooks.length === 0) {
    searchList.innerHTML = `
      <div class="empty-state">
        <p>No results found.</p>
      </div>
    `;
    lucide.createIcons();
    searchLoadMoreContainer.classList.add("hidden");
    return;
  }

  // 3. Render Books
  const booksToShow = searchResultsBooks.slice(0, currentSearchResultsLimit);
  renderBooks(booksToShow, searchList, true, false);

  // 4. Location prompt always at the end
  renderLocationPrompt(searchList);

  if (currentSearchResultsLimit < searchResultsBooks.length) {
    searchLoadMoreContainer.classList.remove("hidden");
  } else {
    searchLoadMoreContainer.classList.add("hidden");
  }

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

  searchLoadMoreBtn.addEventListener("click", () => {
    const hash = window.location.hash;
    if (hash.startsWith("#/search/")) {
      currentSearchResultsLimit += BOOKS_PER_PAGE;
      renderSearchResults();
    } else {
      currentStartPageLimit += BOOKS_PER_PAGE;
      renderStartPage();
    }
  });

  shelfLoadMoreBtn.addEventListener("click", () => {
    currentShelfDetailsLimit += BOOKS_PER_PAGE;
    renderShelfDetails();
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

  if (hash.startsWith("#/shelf/") || hash.startsWith("#/map/shelf/")) {
    const parts = hash.split("/");
    const shelfId = hash.startsWith("#/shelf/") ? parts[2] : parts[3];

    if (shelfId) {
      const shelf = bookshelves.find((g) =>
        g.memberIds.some(
          (id) => String(id).toLowerCase() === String(shelfId).toLowerCase(),
        ),
      );
      if (shelf) {
        console.log("Found shelf group:", shelf.name);
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
        showBookshelfDetails(shelf, false, shelfId);
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


