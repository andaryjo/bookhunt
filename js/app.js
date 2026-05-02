// Global State
let bookshelves = [];
let booksData = [];
let map = null;
let markers = {};
let currentFile = null;
let userLocation = { lat: 52.5200, lon: 13.4050 }; // Default Berlin

// DOM Elements
const mapEl = document.getElementById('map');
const bookshelfInfo = document.getElementById('bookshelfInfo');
const shelfName = document.getElementById('shelfName');
const shelfDesc = document.getElementById('shelfDesc');
const bookList = document.getElementById('bookList');

const searchResults = document.getElementById('searchResults');
const searchList = document.getElementById('searchList');
const searchInput = document.getElementById('searchInput');

const uploadModal = document.getElementById('uploadModal');
const openUploadBtn = document.getElementById('openUploadBtn');
const closeUploadBtn = document.getElementById('closeUploadBtn');
const bookshelfSelect = document.getElementById('bookshelfSelect');
const imageInput = document.getElementById('imageInput');
const dropZone = document.getElementById('dropZone');
const previewArea = document.getElementById('previewArea');
const imagePreview = document.getElementById('imagePreview');
const compressionStats = document.getElementById('compressionStats');
const submitBtn = document.getElementById('submitBtn');

// Initialize App
async function init() {
  lucide.createIcons();

  // Try to get user location via IP
  try {
    const geoRes = await fetch('https://ipapi.co/json/');
    if (geoRes.ok) {
      const geoData = await geoRes.json();
      if (geoData.latitude && geoData.longitude) {
        userLocation = { lat: geoData.latitude, lon: geoData.longitude };
        console.log("Detected location:", geoData.city, userLocation);
      }
    }
  } catch (e) {
    console.error("Geolocation failed:", e);
  }

  // Initialize Map
  map = L.map('map').setView([userLocation.lat, userLocation.lon], 12);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(map);

  // Load Data
  await loadData();

  // Setup Event Listeners
  setupEventListeners();
}

// Load static JSON data
async function loadData() {
  try {
    const [shelvesRes, booksRes] = await Promise.all([
      fetch('data/bookshelves.json'),
      fetch('data/books.json')
    ]);

    bookshelves = await shelvesRes.json();
    booksData = await booksRes.json();

    populateMap();
    populateSelect();
    
    // Show recent books initially
    showRecentBooks();
  } catch (error) {
    console.error("Error loading data:", error);
  }
}

// Distance helper (Haversine formula)
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Show 50 most recent books with geographical relevance
function showRecentBooks() {
  if (searchInput.value.trim()) return;

  bookshelfInfo.classList.add('hidden');
  searchResults.classList.remove('hidden');
  
  const resultsHeader = searchResults.querySelector('h2');
  if (resultsHeader) resultsHeader.textContent = "Recent Nearby Books";

  // 1. Calculate distances for all bookshelves
  const shelfDistances = {};
  bookshelves.forEach(s => {
    shelfDistances[s.id] = getDistance(userLocation.lat, userLocation.lon, s.lat, s.lon);
  });

  // 2. Sort all books by a combination of recency and distance
  // We'll prioritize books within 100km, then sort by date.
  // If we don't have enough, we'll take the next ones.
  const allBooksWithMeta = booksData.map(book => ({
    ...book,
    distance: shelfDistances[book.bookshelfId] || Infinity
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
    return new Date(b.timestamp) - new Date(a.timestamp);
  });

  const recentBooks = allBooksWithMeta.slice(0, 50);
  renderBooks(recentBooks, searchList, true, true);
  lucide.createIcons();
}

// Populate map with markers
function populateMap() {
  const iconHtml = `<div class="custom-marker"><i data-lucide="book"></i></div>`;
  const customIcon = L.divIcon({
    html: iconHtml,
    className: '',
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });

  const markersCluster = L.markerClusterGroup({
    chunkedLoading: true
  });

  const markerList = [];
  bookshelves.forEach(shelf => {
    const marker = L.marker([shelf.lat, shelf.lon], { icon: customIcon });

    // Bind click event
    marker.on('click', () => {
      showBookshelfDetails(shelf);
      setTimeout(() => lucide.createIcons(), 10);
    });

    markerList.push(marker);
    markers[shelf.id] = marker;
  });

  markersCluster.addLayers(markerList);
  map.addLayer(markersCluster);

  // Re-render icons when cluster expands/collapses or map moves
  map.on('moveend', () => {
    lucide.createIcons();
  });

  lucide.createIcons();
}

// Populate the select dropdown in the upload modal
function populateSelect() {
  bookshelves.forEach(shelf => {
    const option = document.createElement('option');
    option.value = shelf.id;
    option.textContent = shelf.name;
    bookshelfSelect.appendChild(option);
  });
}

// Render Bookshelf details on the sidebar
function showBookshelfDetails(shelf) {
  // Hide search results
  searchResults.classList.add('hidden');
  bookshelfInfo.classList.remove('hidden');

  shelfName.textContent = shelf.name;
  shelfDesc.textContent = shelf.address || shelf.description || '';

  // Find books for this shelf
  const allBooks = booksData.filter(book => String(book.bookshelfId) === String(shelf.id));

  // Sort by newest first
  allBooks.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  renderBooks(allBooks, bookList, false);
}

function renderShelves(shelves, container) {
  shelves.forEach(shelf => {
    const card = document.createElement('div');
    card.className = 'shelf-card';
    card.innerHTML = `
      <div class="shelf-title-row">
        <h4><i data-lucide="library" class="small-icon"></i> ${shelf.name}</h4>
      </div>
      <p class="text-muted small" style="margin: 0; margin-top: 4px;">${shelf.address || shelf.description || 'Public bookshelf'}</p>
    `;
    card.addEventListener('click', () => {
      map.setView([shelf.lat, shelf.lon], 16);
      showBookshelfDetails(shelf);
      lucide.createIcons();
    });
    container.appendChild(card);
  });
}

function renderBooks(books, container, showShelfLink = false, clearContainer = true) {
  if (clearContainer) {
    container.innerHTML = '';
  }

  if (books.length === 0) {
    if (clearContainer) {
      container.innerHTML = `
        <div class="empty-state">
          <i data-lucide="ghost"></i>
          <p>No books found here recently.</p>
        </div>
      `;
      lucide.createIcons();
    }
    return;
  }

  books.forEach(book => {
    // Extract date from ISO string directly to avoid timezone shifts
    const date = book.timestamp ? book.timestamp.split('T')[0] : 'Unknown';
    let shelfLinkHtml = '';

    if (showShelfLink) {
      const shelf = bookshelves.find(s => String(s.id) === String(book.bookshelfId));
      if (shelf) {
        shelfLinkHtml = `<span class="book-shelf-link" data-shelf-id="${shelf.id}">${shelf.name}</span> • `;
      }
    }

    const card = document.createElement('div');
    card.className = 'book-card';
    card.innerHTML = `
      <div class="book-title-row">
        <h4>${book.title || 'Unknown Title'}</h4> <span class="author-text">by ${book.author || 'Unknown Author'}</span>
      </div>
      <div class="book-meta">
        <span>${shelfLinkHtml}Last seen: ${date}</span>
      </div>
    `;
    container.appendChild(card);
  });

  // Add event listeners for shelf links in search results
  if (showShelfLink) {
    container.querySelectorAll('.book-shelf-link').forEach(link => {
      link.addEventListener('click', (e) => {
        const shelfId = e.target.getAttribute('data-shelf-id');
        const shelf = bookshelves.find(s => String(s.id) === String(shelfId));
        if (shelf) {
          map.setView([shelf.lat, shelf.lon], 16);
          showBookshelfDetails(shelf);
        }
      });
    });
  }
}

// Search Logic
async function handleSearch(query) {
  if (!query) {
    showRecentBooks();
    return;
  }

  query = query.toLowerCase().trim();
  bookshelfInfo.classList.add('hidden');
  searchResults.classList.remove('hidden');
  
  const resultsHeader = searchResults.querySelector('h2');
  if (resultsHeader) resultsHeader.textContent = "Search Results";

  const cleanQuery = query.replace(/-/g, '');
  const isIsbn = (cleanQuery.length === 10 || cleanQuery.length === 13) && /^\d+$/.test(cleanQuery);
  let searchTitle = query;

  if (isIsbn) {
    try {
      const res = await fetch(`https://openlibrary.org/isbn/${cleanQuery}.json`);
      if (res.ok) {
        const data = await res.json();
        if (data.title) {
          searchTitle = data.title.toLowerCase();
        }
      }
    } catch (e) {
      console.error("Failed to resolve ISBN from OpenLibrary", e);
    }
  }

  let shelfResults = [];
  if (!isIsbn) {
    bookshelves.forEach(shelf => {
      if (
        (shelf.name && shelf.name.toLowerCase().includes(query)) ||
        (shelf.description && shelf.description.toLowerCase().includes(query)) ||
        (shelf.address && shelf.address.toLowerCase().includes(query))
      ) {
        shelfResults.push(shelf);
      }
    });
  }

  let results = [];

  booksData.forEach(book => {
    if (
      (book.title && book.title.toLowerCase().includes(searchTitle)) ||
      (!isIsbn && book.author && book.author.toLowerCase().includes(query))
    ) {
      results.push(book);
    }
  });

  results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  searchList.innerHTML = '';

  if (shelfResults.length === 0 && results.length === 0) {
    searchList.innerHTML = `
      <div class="empty-state">
        <i data-lucide="ghost"></i>
        <p>No results found.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  if (shelfResults.length > 0) {
    const shelfContainer = document.createElement('div');
    shelfContainer.className = 'shelf-results-container';
    searchList.appendChild(shelfContainer);

    renderShelves(shelfResults.slice(0, 5), shelfContainer);

    if (shelfResults.length > 5) {
      const moreBtn = document.createElement('button');
      moreBtn.className = 'outline secondary small';
      moreBtn.style.width = '100%';
      moreBtn.style.marginBottom = '1rem';
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

// Event Listeners Setup
function setupEventListeners() {
  // Search
  let searchTimeout;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      handleSearch(e.target.value);
    }, 300);
  });

  // Upload Modal
  openUploadBtn.addEventListener('click', () => uploadModal.showModal());
  closeUploadBtn.addEventListener('click', () => uploadModal.close());

  // Drag and Drop
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) {
      handleFile(e.dataTransfer.files[0]);
    }
  });

  imageInput.addEventListener('change', (e) => {
    if (e.target.files.length) {
      handleFile(e.target.files[0]);
    }
  });

  submitBtn.addEventListener('click', processAndSubmit);
}

async function handleFile(file) {
  if (!file.type.startsWith('image/')) {
    alert('Please select an image file.');
    return;
  }

  currentFile = file;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Compressing...';

  try {
    const options = {
      maxSizeMB: 0.8, // 800KB goal
      maxWidthOrHeight: 1920,
      useWebWorker: true
    };

    const compressedFile = await imageCompression(file, options);

    // Show preview
    const reader = new FileReader();
    reader.onload = (e) => {
      imagePreview.src = e.target.result;
      dropZone.classList.add('hidden');
      previewArea.classList.remove('hidden');

      const originalSize = (file.size / 1024 / 1024).toFixed(2);
      const newSize = (compressedFile.size / 1024 / 1024).toFixed(2);
      compressionStats.textContent = `Original: ${originalSize}MB | Compressed: ${newSize}MB`;

      submitBtn.disabled = false;
      submitBtn.textContent = 'Process & Submit';
    };
    reader.readAsDataURL(compressedFile);

  } catch (error) {
    console.error("Compression error:", error);
    alert('Error compressing image.');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Process & Submit';
  }
}



// Start app
document.addEventListener('DOMContentLoaded', init);
