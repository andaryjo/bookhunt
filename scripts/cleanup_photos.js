const fs = require('fs');
const path = require('path');

const PHOTO_REPO = 'bookhuntbrutor/bookhunt-photos';
const BASE_BRANCH = 'main';
const queuePath = path.join(__dirname, '..', 'queue.json');
const queueDir = path.join(__dirname, '..', 'queue');
const token = process.env.GH_TOKEN;

async function main() {
  let queue = [];
  const processedFiles = [];

  // 1. Collect from legacy queue.json
  if (fs.existsSync(queuePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
      if (Array.isArray(data)) {
        queue = queue.concat(data);
        processedFiles.push(queuePath);
      }
    } catch (e) {
      console.error("Failed to parse queue.json", e);
    }
  }

  // 2. Collect from new queue/ directory
  if (fs.existsSync(queueDir)) {
    const files = fs.readdirSync(queueDir).filter(f => f !== '.gitkeep');
    for (const file of files) {
      try {
        const filePath = path.join(queueDir, file);
        const content = fs.readFileSync(filePath, 'utf-8').trim();
        if (!content) continue;

        try {
          const data = JSON.parse(content);
          if (Array.isArray(data)) {
            queue = queue.concat(data);
          } else {
            const url = typeof data === 'string' ? data : data.url;
            if (url) queue.push(url);
          }
        } catch (e) {
          // Not JSON, treat as raw URL
          queue.push(content);
        }
        processedFiles.push(filePath);
      } catch (e) {
        console.error(`Failed to read queue/${file}`, e);
      }
    }
  }

  if (queue.length === 0) {
    console.log("Queue is empty. Nothing to cleanup.");
    return;
  }

  if (!token) {
    console.error("GH_TOKEN environment variable is required for cleanup.");
    process.exit(1);
  }

  console.log(`Deleting ${queue.length} photos from GitHub repository ${PHOTO_REPO}...`);

  try {
    // 1. Get latest commit SHA
    const commitRes = await fetch(`https://api.github.com/repos/${PHOTO_REPO}/commits/${BASE_BRANCH}`, {
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json'
      }
    });
    
    if (!commitRes.ok) {
      throw new Error(`Failed to get base commit: ${commitRes.status} ${commitRes.statusText}`);
    }
    
    const commitData = await commitRes.json();
    const baseSha = commitData.sha;
    const baseTreeSha = commitData.commit.tree.sha;

    // 2. Create tree items with sha: null to delete files
    const treeItems = queue.map(url => {
      const filename = path.basename(url);
      return {
        path: `photos/${filename}`,
        mode: '100644',
        type: 'blob',
        sha: null
      };
    });

    // 3. Create new tree
    const treeRes = await fetch(`https://api.github.com/repos/${PHOTO_REPO}/git/trees`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github+json'
      },
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: treeItems
      })
    });
    
    if (!treeRes.ok) {
      throw new Error(`Failed to create tree: ${treeRes.status} ${await treeRes.text()}`);
    }
    const newTree = await treeRes.json();

    // 4. Create commit
    const newCommitRes = await fetch(`https://api.github.com/repos/${PHOTO_REPO}/git/commits`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github+json'
      },
      body: JSON.stringify({
        message: `Cleanup ${queue.length} processed photos`,
        tree: newTree.sha,
        parents: [baseSha]
      })
    });
    
    if (!newCommitRes.ok) {
      throw new Error(`Failed to create commit: ${newCommitRes.status} ${await newCommitRes.text()}`);
    }
    const newCommit = await newCommitRes.json();

    // 5. Update ref
    const refRes = await fetch(`https://api.github.com/repos/${PHOTO_REPO}/git/refs/heads/${BASE_BRANCH}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github+json'
      },
      body: JSON.stringify({ sha: newCommit.sha })
    });

    if (!refRes.ok) {
      throw new Error(`Failed to update ref: ${refRes.status} ${await refRes.text()}`);
    }

    console.log("GitHub cleanup complete.");
    
    // 6. Delete processed queue files
    for (const filePath of processedFiles) {
      fs.unlinkSync(filePath);
      console.log(`Deleted ${path.basename(filePath)}`);
    }

  } catch (err) {
    console.error("Cleanup failed:", err.message);
    process.exit(1);
  }
}

main();
