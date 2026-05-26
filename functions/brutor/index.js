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
  if (!token || token.length < 10) {
    console.error('GH_TOKEN is missing or too short');
    res.status(500).json({ error: 'Server misconfiguration: GH_TOKEN' });
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

  const photoTreeItems = [];
  const photosMetadata = [];

  // 1. Prepare blobs for photos repo
  for (const photo of photos) {
    const id = photo.id || randomId(6);
    const filename = `${id}.jpg`;
    
    // Date validation
    if (!/^\d{4}-\d{2}-\d{2}$/.test(photo.date)) {
      throw new Error(`Invalid date format for photo ${id}. Expected yyyy-mm-dd.`);
    }

    const photoDate = new Date(photo.date);
    const now = new Date();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(now.getDate() - 7);

    if (isNaN(photoDate.getTime())) {
      throw new Error(`Invalid date provided for photo ${id}`);
    }
    if (photoDate > now) {
      throw new Error(`Photo date cannot be in the future (photo ${id})`);
    }
    if (photoDate < sevenDaysAgo) {
      throw new Error(`Photo date cannot be more than 7 days in the past (photo ${id})`);
    }

    photosMetadata.push({ 
      id, 
      filename, 
      date: photoDate.toISOString().split('T')[0],
      suggestedShelfId: photo.shelfId 
    });

    const blob = await ghPhoto('/git/blobs', {
      method: 'POST',
      body: { content: photo.data, encoding: 'base64' },
    });
    photoTreeItems.push({ path: `photos/${filename}`, mode: '100644', type: 'blob', sha: blob.sha });
  }

  // 2. Commit photos directly to PHOTO_REPO/main
  // Using /commits/ instead of /git/ref/ for better robustness
  const photoCommitData = await ghPhoto(`/commits/${BASE_BRANCH}`);
  const photoBaseSha = photoCommitData.sha;
  const photoTreeSha = photoCommitData.commit.tree.sha;

  const photoTree = await ghPhoto('/git/trees', {
    method: 'POST',
    body: { base_tree: photoTreeSha, tree: photoTreeItems },
  });

  const photoNewCommit = await ghPhoto('/git/commits', {
    method: 'POST',
    body: {
      message: `Add ${photosMetadata.length} contribution photos`,
      tree: photoTree.sha,
      parents: [photoBaseSha]
    },
  });

  await ghPhoto(`/git/refs/heads/${BASE_BRANCH}`, {
    method: 'PATCH',
    body: { sha: photoNewCommit.sha },
  });

  // 3. Update queue (individual file per photo to avoid merge conflicts)
  const mainCommitData = await ghMain(`/commits/${BASE_BRANCH}`);
  const mainBaseSha = mainCommitData.sha;
  const mainTreeSha = mainCommitData.commit.tree.sha;

  const contributionId = randomId(8);
  const queueTreeItems = [];

  for (let i = 0; i < photosMetadata.length; i++) {
    const meta = photosMetadata[i];
    const url = `https://raw.githubusercontent.com/${PHOTO_REPO}/${BASE_BRANCH}/photos/${meta.filename}`;
    
    const queueData = {
      url,
      date: meta.date,
      suggestedShelfId: meta.suggestedShelfId
    };

    const queueBlob = await ghMain('/git/blobs', {
      method: 'POST',
      body: { content: JSON.stringify(queueData, null, 2), encoding: 'utf-8' },
    });

    queueTreeItems.push({
      path: `queue/${meta.id}.json`,
      mode: '100644',
      type: 'blob',
      sha: queueBlob.sha
    });
  }

  const mainTree = await ghMain('/git/trees', {
    method: 'POST',
    body: {
      base_tree: mainTreeSha,
      tree: queueTreeItems
    },
  });

  const mainNewCommit = await ghMain('/git/commits', {
    method: 'POST',
    body: {
      message: `Queue contribution ${contributionId} (${photosMetadata.length} photos)`,
      tree: mainTree.sha,
      parents: [mainBaseSha]
    },
  });

  const branchName = `contribute/${contributionId}`;
  await ghMain('/git/refs', {
    method: 'POST',
    body: { ref: `refs/heads/${branchName}`, sha: mainNewCommit.sha },
  });

  // 4. Open PR
  const prBody = [
    `Thank you for your contribution. The pictures will now get reviewed by a human and automatically processed after approval. This process may take a few hours.`,
    ``,
    `Photos submitted for review:`,
    ...photosMetadata.map(m => `- [${m.filename}](https://github.com/${PHOTO_REPO}/blob/${BASE_BRANCH}/photos/${m.filename})`),
  ].join('\n');

  const pr = await ghMain('/pulls', {
    method: 'POST',
    body: {
      title: `Bookshelf photo contribution (${photosMetadata.length} photo${photosMetadata.length > 1 ? 's' : ''})`,
      head: branchName,
      base: BASE_BRANCH,
      body: prBody,
    },
  });

  return { prUrl: pr.html_url, prNumber: pr.number, photos: photosMetadata.length };
}

function makeGhClient(repo, token) {
  return async function gh(path, opts = {}) {
    const url = `https://api.github.com/repos/${repo}${path}`;
    const res = await fetch(
      url,
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
      try {
        const data = await res.json();
        msg = data.message || msg;
        console.error(`GitHub API Error details for ${url}:`, JSON.stringify(data));
      } catch { }
      throw new Error(`GitHub API ${repo}${path}: ${msg}`);
    }

    return res.json();
  };
}


function randomId(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
