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
 * Clusters bookshelves within 50m and prioritizes metadata
 */
function clusterBookshelves(shelves) {
  if (shelves.length === 0) return [];

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
      if (dist <= 0.05) {
        // 50 meters
        group.memberIds.push(String(s2.id));
        group.members.push(s2);
        processed.add(s2.id);
      }
    }

    // Pick the best name and address (deprioritize OSM)
    const nonOsmMembers = group.members.filter(
      (m) => !m.sourceId || (typeof m.sourceId === "string" && !m.sourceId.startsWith("osm_")),
    );
    const preferredMembers =
      nonOsmMembers.length > 0 ? nonOsmMembers : group.members;

    group.name = "";
    group.address = "";

    preferredMembers.forEach((m) => {
      const mName = m.name || "";
      const mAddress = m.address || m.description || "";
      if (mName.length > group.name.length) group.name = mName;
      if (mAddress.length > group.address.length) group.address = mAddress;
    });

    groups.push(group);
  }
  return groups;
}

if (typeof window !== 'undefined') {
  window.getDistance = getDistance;
  window.clusterBookshelves = clusterBookshelves;
}
