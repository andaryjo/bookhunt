/**
 * Cleans and normalizes a string for similarity comparison:
 * - Lowercases the string
 * - Removes punctuation and special characters
 * - Collapses whitespace
 */
function cleanString(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, '') // remove punctuation
    .replace(/\s+/g, ' ')                          // collapse multiple spaces
    .trim();
}

/**
 * Calculates the Levenshtein distance between two strings.
 */
function levenshteinDistance(s1, s2) {
  const m = s1.length;
  const n = s2.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,    // Deletion
          dp[i][j - 1] + 1,    // Insertion
          dp[i - 1][j - 1] + 1 // Substitution
        );
      }
    }
  }
  return dp[m][n];
}

/**
 * Calculates normalized similarity between two strings (value between 0.0 and 1.0).
 */
function getStringSimilarity(s1, s2) {
  const clean1 = cleanString(s1);
  const clean2 = cleanString(s2);

  if (!clean1 && !clean2) return 1.0;
  if (!clean1 || !clean2) return 0.0;
  if (clean1 === clean2) return 1.0;

  const distance = levenshteinDistance(clean1, clean2);
  const maxLength = Math.max(clean1.length, clean2.length);
  return 1.0 - (distance / maxLength);
}

/**
 * Determines if two books are similar based on title, author, and bookshelf.
 */
function areBooksSimilar(book1, book2, threshold = 0.8) {
  // Books must be on the same bookshelf to be duplicates
  if (book1.bookshelfId !== book2.bookshelfId) {
    return false;
  }

  const titleSim = getStringSimilarity(book1.title, book2.title);

  const a1 = cleanString(book1.author);
  const a2 = cleanString(book2.author);
  const hasUnknownAuthor = a1 === 'unknown' || a2 === 'unknown' || !a1 || !a2;

  if (hasUnknownAuthor) {
    // If author is unknown on either side, check if title is highly similar
    return titleSim >= Math.max(threshold, 0.85);
  }

  const authorSim = getStringSimilarity(book1.author, book2.author);
  return titleSim >= threshold && authorSim >= threshold;
}

/**
 * Decides which field value is better to keep between two similar books.
 * Prefers the non-empty, non-unknown value, and falls back to preferVal1 if both are known/unknown.
 */
function chooseBetterField(val1, val2, preferVal1) {
  const clean1 = (val1 || '').trim().toLowerCase();
  const clean2 = (val2 || '').trim().toLowerCase();

  const isVal1Unknown = !clean1 || clean1 === 'unknown';
  const isVal2Unknown = !clean2 || clean2 === 'unknown';

  if (isVal1Unknown && !isVal2Unknown) {
    return val2;
  }
  if (!isVal1Unknown && isVal2Unknown) {
    return val1;
  }
  return preferVal1 ? val1 : val2;
}

module.exports = {
  cleanString,
  levenshteinDistance,
  getStringSimilarity,
  areBooksSimilar,
  chooseBetterField
};
