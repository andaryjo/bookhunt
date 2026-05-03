const MAIN_REPO = 'andaryjo/bookhunt';
const PHOTO_REPO = 'bookhuntbrutor/bookhunt-photos';
const BASE_BRANCH = 'main';
const MAX_PHOTOS = 10;

exports.contribute = async (req, res) => {
  // CORS
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

  const token = process.env.GH_TOKEN;
  if (!token) {
    console.error('GH_TOKEN secret not configured');
    res.status(500).json({ error: 'Server misconfiguration' });
    return;
  }

  try {
    const result = await processContribution(photos, token);
    res.status(200).json(result);
  } catch (err) {
    console.error('Contribution failed:', err.message);
    res.status(500).json({ error: err.message || 'Internal error' });
  }
};

async function processContribution(photos, token) {
  const ghMain = makeGhClient(MAIN_REPO, token);
  const ghPhoto = makeGhClient(PHOTO_REPO, token);

  const today = utcDateString();
  const filenames = [];
  const photoTreeItems = [];

  // 1. Prepare blobs for photos repo
  for (const photo of photos) {
    const id = randomId(6);
    const shelfPart = photo.shelfId || (photo.lat != null && photo.lon != null ? `${photo.lat}_${photo.lon}` : 'unknown');
    const filename = `${id}_${today}_${shelfPart}.jpg`;
    filenames.push(filename);

    const blob = await ghPhoto('/git/blobs', {
      method: 'POST',
      body: { content: photo.data, encoding: 'base64' },
    });
    photoTreeItems.push({ path: `photos/${filename}`, mode: '100644', type: 'blob', sha: blob.sha });
  }

  // 2. Commit photos directly to PHOTO_REPO/main
  const photoRef = await ghPhoto(`/git/ref/heads/${BASE_BRANCH}`);
  const photoBaseSha = photoRef.object.sha;
  const photoCommit = await ghPhoto(`/git/commits/${photoBaseSha}`);
  
  const photoTree = await ghPhoto('/git/trees', {
    method: 'POST',
    body: { base_tree: photoCommit.tree.sha, tree: photoTreeItems },
  });

  const photoNewCommit = await ghPhoto('/git/commits', {
    method: 'POST',
    body: {
      message: `Add ${filenames.length} contribution photos`,
      tree: photoTree.sha,
      parents: [photoBaseSha]
    },
  });

  await ghPhoto(`/git/ref/heads/${BASE_BRANCH}`, {
    method: 'PATCH',
    body: { sha: photoNewCommit.sha },
  });

  // 3. Update queue.json on MAIN_REPO (in a new branch)
  const mainRef = await ghMain(`/git/ref/heads/${BASE_BRANCH}`);
  const mainBaseSha = mainRef.object.sha;
  const mainCommit = await ghMain(`/git/commits/${mainBaseSha}`);
  
  // Read existing queue.json
  let currentQueue = [];
  try {
    const queueFile = await ghMain('/contents/queue.json');
    const content = Buffer.from(queueFile.content, 'base64').toString('utf-8');
    currentQueue = JSON.parse(content);
  } catch (e) {
    console.log('No existing queue.json found, starting fresh');
  }

  const newPhotoUrls = filenames.map(f => `https://raw.githubusercontent.com/${PHOTO_REPO}/${BASE_BRANCH}/photos/${f}`);
  const updatedQueue = [...currentQueue, ...newPhotoUrls];

  const queueBlob = await ghMain('/git/blobs', {
    method: 'POST',
    body: { content: JSON.stringify(updatedQueue, null, 2), encoding: 'utf-8' },
  });

  const mainTree = await ghMain('/git/trees', {
    method: 'POST',
    body: {
      base_tree: mainCommit.tree.sha,
      tree: [{ path: 'queue.json', mode: '100644', type: 'blob', sha: queueBlob.sha }]
    },
  });

  const mainNewCommit = await ghMain('/git/commits', {
    method: 'POST',
    body: {
      message: `Queue ${filenames.length} photos for processing`,
      tree: mainTree.sha,
      parents: [mainBaseSha]
    },
  });

  const branchName = `contribute/${randomId(8)}`;
  await ghMain('/git/refs', {
    method: 'POST',
    body: { ref: `refs/heads/${branchName}`, sha: mainNewCommit.sha },
  });

  // 4. Open PR
  const prBody = [
    `📚 **Bookshelf photo contribution via Bookhunt**`,
    '',
    `**Photos submitted:** ${filenames.length}`,
    ...filenames.map(f => `- [Photo Link](https://github.com/${PHOTO_REPO}/blob/${BASE_BRANCH}/photos/${f})`),
    '',
    '_Photos have been uploaded to the private repository. Merging this PR will add them to the processing queue._',
  ].join('\n');

  const pr = await ghMain('/pulls', {
    method: 'POST',
    body: {
      title: `📸 Photo contribution (${filenames.length} photo${filenames.length > 1 ? 's' : ''})`,
      head: branchName,
      base: BASE_BRANCH,
      body: prBody,
    },
  });

  return { prUrl: pr.html_url, prNumber: pr.number, photos: filenames.length };
}

function makeGhClient(repo, token) {
  return async function gh(path, opts = {}) {
    const res = await fetch(
      `https://api.github.com/repos/${repo}${path}`,
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
      throw new Error(`GitHub API ${repo}${path}: ${msg}`);
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
