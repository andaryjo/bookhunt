/**
 * Shared utility functions for Bookhunt
 */

/**
 * Calculates spherical distance between two points in km
 */
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

/**
 * Clusters bookshelves within 100m and prioritizes metadata
 */
function clusterBookshelves(shelves) {
  if (shelves.length === 0) return [];

  // Assign original manifest index to maintain priority order
  shelves.forEach((s, index) => {
    s._manifestIndex = index;
  });

  // Sort by latitude to allow early exit in the search loop
  const sorted = [...shelves].sort((a, b) => a.lat - b.lat);
  const groups = [];
  const processed = new Set();
  const latThreshold = 0.0006; // Roughly 65m

  for (let i = 0; i < sorted.length; i++) {
    const s1 = sorted[i];
    if (processed.has(s1.id)) continue;

    const group = {
      id: s1.id,
      lat: s1.lat,
      lon: s1.lon,
      memberIds: [String(s1.id)],
      members: [s1],
    };
    processed.add(s1.id);

    // Search only nearby bookshelves in the sorted list
    for (let j = i + 1; j < sorted.length; j++) {
      const s2 = sorted[j];

      if (s2.lat - s1.lat > latThreshold) break;
      if (processed.has(s2.id)) continue;

      const dist = getDistance(s1.lat, s1.lon, s2.lat, s2.lon);
      if (dist <= 0.1) {
        group.memberIds.push(String(s2.id));
        group.members.push(s2);
        processed.add(s2.id);
      }
    }

    // Sort members back to manifest priority order
    group.members.sort((a, b) => a._manifestIndex - b._manifestIndex);

    group.name = "";
    for (const m of group.members) {
      if (m.name && m.name.trim().length > 0) {
        group.name = m.name;
        break;
      }
    }

    group.address = "";
    for (const m of group.members) {
      const mAddress = m.address || m.description || "";
      if (mAddress.trim().length > 0) {
        group.address = mAddress;
        break;
      }
    }

    groups.push(group);
  }
  return groups;
}
/**
 * Formats a date string into a relative "days ago" text
 */
function formatDaysAgo(dateString) {
  if (!dateString || dateString === "Unknown") {
    return "unknown";
  }

  let bookDate;
  // If dateString matches YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    const parts = dateString.split("-");
    bookDate = new Date(
      parseInt(parts[0], 10),
      parseInt(parts[1], 10) - 1,
      parseInt(parts[2], 10)
    );
  } else {
    bookDate = new Date(dateString);
  }

  if (isNaN(bookDate.getTime())) {
    return "unknown";
  }

  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const bookMidnight = new Date(bookDate.getFullYear(), bookDate.getMonth(), bookDate.getDate());

  const diffTime = todayMidnight - bookMidnight;
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return "today";
  }
  if (diffDays === 0) {
    return "today";
  }
  if (diffDays === 1) {
    return "yesterday";
  }
  return `${diffDays} days ago`;
}

if (typeof window !== "undefined") {
  window.getDistance = getDistance;
  window.clusterBookshelves = clusterBookshelves;
  window.formatDaysAgo = formatDaysAgo;
}
