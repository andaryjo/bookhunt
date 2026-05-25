const { cleanString, levenshteinDistance, getStringSimilarity, areBooksSimilar, chooseBetterField } = require('./similarity');

let totalTests = 0;
let passedTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`✅ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`❌ FAIL: ${name}`);
    console.error(err.stack || err);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

// ----------------------------------------------------
// Tests
// ----------------------------------------------------

test('cleanString should lowercase, remove punctuation, and collapse spacing', () => {
  assert(cleanString('The Great Gatsby!') === 'the great gatsby', 'Failed punctuation removal');
  assert(cleanString('  J. R.  R. Tolkien ') === 'j r r tolkien', 'Failed spacing collapse');
  assert(cleanString(null) === '', 'Failed null handling');
});

test('levenshteinDistance calculation', () => {
  assert(levenshteinDistance('kitten', 'sitting') === 3, 'Kitten to sitting distance should be 3');
  assert(levenshteinDistance('book', 'back') === 2, 'Book to back distance should be 2');
  assert(levenshteinDistance('same', 'same') === 0, 'Same strings distance should be 0');
});

test('getStringSimilarity scoring', () => {
  const sim1 = getStringSimilarity('The Great Gatsby', 'The Great Gatsbi');
  assert(sim1 > 0.85, `Similarity ${sim1} should be high for one character difference`);

  const sim2 = getStringSimilarity('The Great Gatsby', 'Harry Potter');
  assert(sim2 < 0.3, `Similarity ${sim2} should be low for completely different books`);
});

test('areBooksSimilar - exact match', () => {
  const book1 = { title: 'The Hobbit', author: 'J.R.R. Tolkien', bookshelfId: 'shelf-1' };
  const book2 = { title: 'The Hobbit', author: 'J.R.R. Tolkien', bookshelfId: 'shelf-1' };
  assert(areBooksSimilar(book1, book2) === true, 'Exact match should be similar');
});

test('areBooksSimilar - minor typos in title and author', () => {
  const book1 = { title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', bookshelfId: 'shelf-1' };
  const book2 = { title: 'The Great Gatsbi', author: 'F. Scot Fitzgerald', bookshelfId: 'shelf-1' };
  assert(areBooksSimilar(book1, book2) === true, 'Minor typos should be matched as similar');
});

test('areBooksSimilar - case and punctuation differences', () => {
  const book1 = { title: 'The Fellowship of the Ring!', author: 'J. R. R. Tolkien', bookshelfId: 'shelf-2' };
  const book2 = { title: 'the fellowship of the ring', author: 'j.r.r. tolkien', bookshelfId: 'shelf-2' };
  assert(areBooksSimilar(book1, book2) === true, 'Case and punctuation differences should be ignored');
});

test('areBooksSimilar - different bookshelves', () => {
  const book1 = { title: '1984', author: 'George Orwell', bookshelfId: 'shelf-1' };
  const book2 = { title: '1984', author: 'George Orwell', bookshelfId: 'shelf-2' };
  assert(areBooksSimilar(book1, book2) === false, 'Different bookshelfIds should not be similar');
});

test('areBooksSimilar - completely different books', () => {
  const book1 = { title: '1984', author: 'George Orwell', bookshelfId: 'shelf-1' };
  const book2 = { title: 'Animal Farm', author: 'George Orwell', bookshelfId: 'shelf-1' };
  assert(areBooksSimilar(book1, book2) === false, 'Different titles by same author should not be similar');
});

test('areBooksSimilar - unknown author matching', () => {
  const book1 = { title: 'To Kill a Mockingbird', author: 'Harper Lee', bookshelfId: 'shelf-1' };
  const book2 = { title: 'To Kill a Mockingbird', author: 'unknown', bookshelfId: 'shelf-1' };
  assert(areBooksSimilar(book1, book2) === true, 'Matching title with unknown author should be similar');

  const book3 = { title: 'To Kill a Mockingbird!', author: 'unknown', bookshelfId: 'shelf-1' };
  assert(areBooksSimilar(book2, book3) === true, 'Unknown author with similar title should be similar');

  const book4 = { title: 'Go Set a Watchman', author: 'unknown', bookshelfId: 'shelf-1' };
  assert(areBooksSimilar(book1, book4) === false, 'Unknown author with different title should not be similar');
});

test('chooseBetterField - preserves known values', () => {
  // If one value is unknown, prefer the known value
  assert(chooseBetterField('unknown', 'Harper Lee', true) === 'Harper Lee', 'Should choose Harper Lee over unknown (preferNew = true)');
  assert(chooseBetterField('Harper Lee', 'unknown', false) === 'Harper Lee', 'Should choose Harper Lee over unknown (preferNew = false)');
  assert(chooseBetterField('', 'Harper Lee', true) === 'Harper Lee', 'Should choose Harper Lee over empty string');

  // If both values are known, follow the preference (preferNew)
  assert(chooseBetterField('Harper Lee', 'H. Lee', true) === 'Harper Lee', 'Should choose first value if preferNew is true');
  assert(chooseBetterField('Harper Lee', 'H. Lee', false) === 'H. Lee', 'Should choose second value if preferNew is false');

  // If both values are unknown, follow the preference (preferNew)
  assert(chooseBetterField('unknown', '', true) === 'unknown', 'Should fallback to val1');
  assert(chooseBetterField('unknown', '', false) === '', 'Should fallback to val2');
});

// Summary
console.log(`\n=== Test Summary: ${passedTests}/${totalTests} passed ===`);
if (passedTests !== totalTests) {
  process.exit(1);
}
