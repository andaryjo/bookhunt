// Global State
let bookshelves = [];
let booksData = [];
let map = null;
let markers = {};
let currentFile = null;
let userLocation = { lat: 52.52, lon: 13.405 }; // Default Berlin

// DOM Elements
const mapEl = document.getElementById("map");
const bookshelfInfo = document.getElementById("bookshelfInfo");
const shelfName = document.getElementById("shelfName");
const shelfDesc = document.getElementById("shelfDesc");
const bookList = document.getElementById("bookList");

const searchResults = document.getElementById("searchResults");
const searchList = document.getElementById("searchList");
const searchInput = document.getElementById("searchInput");

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

  // Try to get user location via IP
  try {
    const geoRes = await fetch("https://ipapi.co/json/");
    if (geoRes.ok) {
      const geoData = await geoRes.json();
      if (geoData.latitude && geoData.longitude) {
        userLocation = { lat: geoData.latitude, lon: geoData.longitude };
        console.log("Detected location:", geoData.city, userLocation);
      }
    }
  } catch (e) {
    console.warn("Geolocation failed, using default:", e.message);
  }

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

  // 6. Initialize contribute flow (needs bookshelves + getDistance to be available)
  if (typeof window.initContribute === 'function') {
    window.initContribute();
  }
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

// Show 50 most recent books with geographical relevance
function showRecentBooks() {
  if (searchInput.value.trim()) return;

  bookshelfInfo.classList.add("hidden");
  searchResults.classList.remove("hidden");

  const resultsHeader = searchResults.querySelector("h2");
  if (resultsHeader) resultsHeader.textContent = "Recently seen books";

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

  // 2. Sort all books by a combination of recency and distance
  // We'll prioritize books within 100km, then sort by date.
  // If we don't have enough, we'll take the next ones.
  const allBooksWithMeta = booksData.map((book) => ({
    ...book,
    distance: shelfDistances[book.bookshelfId] || Infinity,
  }));

  // Sort logic:
  // Primary: Is it "nearby" (e.g. < 100km)?
  // Secondary: Timestamp
  allBooksWithMeta.sort((a, b) => {
    const aNearby = a.distance < 100;
    const bNearby = b.distance < 100;

    if (aNearby && !bNearby) return -1;
    if (!aNearby && bNearby) return 1;

    // Both nearby or both far, sort by date
    return new Date(b.date) - new Date(a.date);
  });

  const recentBooks = allBooksWithMeta.slice(0, 50);
  renderBooks(recentBooks, searchList, true, true);
}

// Populate map with markers
function populateMap() {
  const iconHtml = `<div class="custom-marker">📚</div>`;
  const customIcon = L.divIcon({
    html: iconHtml,
    className: "",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });

  const markersCluster = L.markerClusterGroup({
    chunkedLoading: true,
  });

  const markerList = [];
  bookshelves.forEach((shelf) => {
    const marker = L.marker([shelf.lat, shelf.lon], { icon: customIcon });

    // Bind click event
    marker.on("click", () => {
      showBookshelfDetails(shelf);
      setTimeout(() => lucide.createIcons(), 10);
    });

    markerList.push(marker);
    markers[shelf.id] = marker;
  });

  markersCluster.addLayers(markerList);
  map.addLayer(markersCluster);

  // Re-render icons when cluster expands/collapses or map moves
  map.on("moveend", () => {
    lucide.createIcons();
  });

  lucide.createIcons();
}

// Render Bookshelf details on the sidebar
function showBookshelfDetails(shelf, updateUrl = true) {
  if (updateUrl) {
    window.location.hash = `/shelf/${shelf.id}`;
  }

  // Hide search results
  searchResults.classList.add("hidden");
  bookshelfInfo.classList.remove("hidden");

  shelfName.textContent = shelf.name;
  shelfDesc.textContent = shelf.address || shelf.description || "";

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

function renderShelves(shelves, container) {
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
      map.setView([shelf.lat, shelf.lon], 16);
      showBookshelfDetails(shelf);
      lucide.createIcons();
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
        const shelf = bookshelves.find((s) => String(s.id) === String(shelfId));
        if (shelf) {
          map.setView([shelf.lat, shelf.lon], 16);
          showBookshelfDetails(shelf);
        }
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
  bookshelfInfo.classList.add("hidden");
  searchResults.classList.remove("hidden");

  const resultsHeader = searchResults.querySelector("h2");
  if (resultsHeader) resultsHeader.textContent = "Search Results";

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

  let results = [];

  booksData.forEach((book) => {
    if (
      (book.title && book.title.toLowerCase().includes(searchTitle)) ||
      (book.author && book.author.toLowerCase().includes(query))
    ) {
      results.push(book);
    }
  });

  results.sort((a, b) => new Date(b.date) - new Date(a.date));

  searchList.innerHTML = "";

  if (shelfResults.length === 0 && results.length === 0) {
    searchList.innerHTML = `
      <div class="empty-state">
        <span style="font-size: 3rem;">👻</span>
        <p>No results found.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  if (shelfResults.length > 0) {
    const shelfContainer = document.createElement("div");
    shelfContainer.className = "shelf-results-container";
    searchList.appendChild(shelfContainer);

    renderShelves(shelfResults.slice(0, 5), shelfContainer);

    if (shelfResults.length > 5) {
      const moreBtn = document.createElement("button");
      moreBtn.className = "outline secondary small";
      moreBtn.style.width = "100%";
      moreBtn.style.marginBottom = "1rem";
      moreBtn.innerText = `Show ${Math.min(shelfResults.length - 5, 20)} more shelves...`;
      moreBtn.onclick = () => {
        moreBtn.remove();
        renderShelves(shelfResults.slice(5, 25), shelfContainer);
        lucide.createIcons();
      };
      shelfContainer.appendChild(moreBtn);
    }
  }

  if (results.length > 0) {
    renderBooks(results.slice(0, 50), searchList, true, false);
  }

  lucide.createIcons();
}

function setupEventListeners() {
  document.querySelector(".brand").addEventListener("click", () => {
    window.location.hash = "";
  });

  let searchTimeout;
  searchInput.addEventListener("input", (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      handleSearch(e.target.value);
    }, 300);
  });
}

async function handleRouting() {
  const hash = window.location.hash;
  console.log("Routing to hash:", hash);

  if (hash.startsWith("#/shelf/")) {
    const parts = hash.split("/");
    const shelfId = parts[2];

    if (shelfId) {
      const shelf = bookshelves.find(
        (s) => String(s.id).toLowerCase() === String(shelfId).toLowerCase(),
      );
      if (shelf) {
        console.log("Found shelf:", shelf.name);
        document.body.classList.add("is-shelf-view");
        // Small delay to allow CSS display: block to take effect before invalidating
        setTimeout(() => {
          if (map) {
            map.invalidateSize();
            map.setView([shelf.lat, shelf.lon], 16);
          }
        }, 50);
        showBookshelfDetails(shelf, false);
        setTimeout(() => lucide.createIcons(), 50);
      } else {
        console.warn("Shelf not found for ID:", shelfId);
        document.body.classList.remove("is-shelf-view");
        showRecentBooks();
      }
    }
  } else if (hash.startsWith("#/search/")) {
    document.body.classList.remove("is-shelf-view");
    const parts = hash.split("/");
    const query = parts[2] ? decodeURIComponent(parts[2]) : "";
    if (query) {
      searchInput.value = query;
      handleSearch(query, false);
    } else {
      showRecentBooks();
    }
  } else {
    // Clear search and show recent
    document.body.classList.remove("is-shelf-view");
    searchInput.value = "";
    showRecentBooks();
  }
  
  // Ensure map size is correct if view changed
  if (map) {
    setTimeout(() => map.invalidateSize(), 100);
  }
}

// Start app
document.addEventListener("DOMContentLoaded", init);
