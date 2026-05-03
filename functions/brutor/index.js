const REPO_OWNER = 'andaryjo';
const REPO_NAME = 'bookhunt';
const BASE_BRANCH = 'main';
const MAX_PHOTOS = 10;

exports.contribute = async (req, res) => {
  // CORS — allow any origin (tighten later if auth is added)
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { photos } = req.body || {};

  if (!Array.isArray(photos) || photos.length === 0) {
    res.status(400).json({ error: 'Provide at least one photo' });
    return;
  }
  if (photos.length > MAX_PHOTOS) {
    res.status(400).json({ error: `Maximum ${MAX_PHOTOS} photos per request` });
    return;
  }
  for (const p of photos) {
    if (!p.data || typeof p.data !== 'string') {
      res.status(400).json({ error: 'Each photo must have a base64 "data" field' });
      return;
    }
    // base64 of 2 MB ≈ 2.7 M chars
    if (p.data.length > 3_000_000) {
      res.status(400).json({ error: 'Photo too large — client must compress below 2 MB' });
      return;
    }
  }

  const token = process.env.GH_TOKEN;
  if (!token) {
    console.error('GH_TOKEN secret not configured');
    res.status(500).json({ error: 'Server misconfiguration' });
    return;
  }

  try {
    const result = await createContributionPR(photos, token);
    res.status(200).json(result);
  } catch (err) {
    console.error('PR creation failed:', err.message);
    res.status(500).json({ error: err.message || 'Internal error' });
  }
};

// ---------------------------------------------------------------------------
// GitHub Git Data API
// Creates all photo blobs in one atomic commit, then opens a PR.
// ---------------------------------------------------------------------------
async function createContributionPR(photos, token) {
  const gh = makeGhClient(token);

  // 1. Resolve base branch → latest commit SHA → base tree SHA
  const refData = await gh(`/git/ref/heads/${BASE_BRANCH}`);
  const baseSha = refData.object.sha;
  const commitData = await gh(`/git/commits/${baseSha}`);
  const baseTreeSha = commitData.tree.sha;

  // 2. Create a blob for every photo
  const today = utcDateString(); // YYYYMMDD
  const treeItems = [];
  const filenames = [];

  for (const photo of photos) {
    const id = randomId(6);
    const shelfPart = photo.shelfId
      ? photo.shelfId
      : (photo.lat != null && photo.lon != null)
        ? `${photo.lat}_${photo.lon}`
        : 'unknown';

    const filename = `${id}_${today}_${shelfPart}.jpg`;
    filenames.push(filename);

    const blob = await gh('/git/blobs', {
      method: 'POST',
      body: { content: photo.data, encoding: 'base64' },
    });

    treeItems.push({ path: `photos/${filename}`, mode: '100644', type: 'blob', sha: blob.sha });
  }

  // 3. New tree → commit → branch (all atomic)
  const newTree = await gh('/git/trees', {
    method: 'POST',
    body: { base_tree: baseTreeSha, tree: treeItems },
  });

  const count = filenames.length;
  const commitMsg = count === 1
    ? `Add bookshelf photo ${filenames[0]}`
    : `Add ${count} bookshelf photos`;

  const newCommit = await gh('/git/commits', {
    method: 'POST',
    body: {
      message: commitMsg,
      tree: newTree.sha,
      parents: [baseSha],
      author: {
        name: 'Brutor',
        email: 'brutor@bookhunt.eu',
        date: new Date().toISOString()
      },
      committer: {
        name: 'Brutor',
        email: 'brutor@bookhunt.eu',
        date: new Date().toISOString()
      }
    },
  });

  const branchName = `contribute/${randomId(8)}`;
  await gh('/git/refs', {
    method: 'POST',
    body: { ref: `refs/heads/${branchName}`, sha: newCommit.sha },
  });

  // 4. Open pull request
  const prBody = [
    `📚 **Bookshelf photo contribution via Bookhunt**`,
    '',
    `**Photos submitted:** ${count}`,
    ...filenames.map(f => `- \`${f}\``),
    '',
    '_Submitted via the Bookhunt website photo contribution feature._',
  ].join('\n');

  const pr = await gh('/pulls', {
    method: 'POST',
    body: {
      title: `📸 Photo contribution (${count} photo${count > 1 ? 's' : ''})`,
      head: branchName,
      base: BASE_BRANCH,
      body: prBody,
      maintainer_can_modify: true,
    },
  });

  return { prUrl: pr.html_url, prNumber: pr.number, photos: count };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeGhClient(token) {
  return async function gh(path, opts = {}) {
    const res = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}${path}`,
      {
        method: opts.method || 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
          'User-Agent': 'bookhunt-contribute-function/1.0',
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      }
    );

    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { msg = (await res.json()).message || msg; } catch { }
      throw new Error(`GitHub API ${path}: ${msg}`);
    }

    return res.json();
  };
}

function utcDateString() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function randomId(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
