const API = 'https://api.github.com';

function config() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO; // "owner/repo"
  const branch = process.env.GITHUB_SAVE_BRANCH || 'code-saves';
  return { token, repo, branch, enabled: Boolean(token && repo) };
}

function dirForRoom(room) {
  const slug = room.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100) || 'general';
  return `saves/${slug}`;
}

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'editor-colaborativo',
  };
}

async function api(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: headers(token),
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `GitHub respondio ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function getBranchHead({ token, repo, branch }) {
  try {
    const ref = await api(token, 'GET', `/repos/${repo}/git/ref/heads/${branch}`);
    return ref.object.sha;
  } catch (err) {
    if (err.status !== 404) throw err;
    return null;
  }
}

async function ensureBranch(cfg) {
  const existing = await getBranchHead(cfg);
  if (existing) return existing;

  const { token, repo, branch } = cfg;
  const repoInfo = await api(token, 'GET', `/repos/${repo}`);
  const defaultBranch = repoInfo.default_branch || 'main';
  const baseSha = await getBranchHead({ ...cfg, branch: defaultBranch });
  if (!baseSha) throw new Error(`No se encontro la branch por defecto "${defaultBranch}".`);

  await api(token, 'POST', `/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: baseSha });
  return baseSha;
}

export function isConfigured() {
  return config().enabled;
}

/** Lista los archivos guardados de una sala. Devuelve [] si no hay nada guardado. */
export async function loadWorkspace(room) {
  const { token, repo, branch, enabled } = config();
  if (!enabled) return [];

  const dir = dirForRoom(room);
  let entries;
  try {
    entries = await api(token, 'GET', `/repos/${repo}/contents/${dir}?ref=${encodeURIComponent(branch)}`);
  } catch (err) {
    if (err.status === 404) return [];
    throw err;
  }
  if (!Array.isArray(entries)) return [];

  const files = [];
  for (const entry of entries) {
    if (entry.type !== 'file') continue;
    const file = await api(
      token,
      'GET',
      `/repos/${repo}/contents/${dir}/${encodeURIComponent(entry.name)}?ref=${encodeURIComponent(branch)}`
    );
    if (!file.content) continue;
    files.push({ name: entry.name, content: Buffer.from(file.content, 'base64').toString('utf8') });
  }
  return files;
}

/**
 * Guarda todo el workspace de una sala (varios archivos) en un unico commit,
 * usando la Git Data API (blobs + tree + commit) en vez de la API de
 * "contents" (que solo permite un archivo por request). Tambien borra del
 * repo los archivos que ya no estan en la sala.
 */
export async function saveWorkspace(room, files, authorName) {
  const cfg = config();
  if (!cfg.enabled) {
    return { ok: false, message: 'El guardado en GitHub no esta configurado en el servidor.' };
  }
  if (!Array.isArray(files) || files.length === 0) {
    return { ok: false, message: 'No hay archivos para guardar.' };
  }

  const { token, repo, branch } = cfg;
  const dir = dirForRoom(room);

  try {
    const headSha = await ensureBranch(cfg);
    const headCommit = await api(token, 'GET', `/repos/${repo}/git/commits/${headSha}`);

    let existingNames = [];
    try {
      const entries = await api(token, 'GET', `/repos/${repo}/contents/${dir}?ref=${encodeURIComponent(branch)}`);
      if (Array.isArray(entries)) existingNames = entries.filter((e) => e.type === 'file').map((e) => e.name);
    } catch (err) {
      if (err.status !== 404) throw err;
    }

    const currentNames = new Set(files.map((f) => f.name));
    const toDelete = existingNames.filter((name) => !currentNames.has(name));

    const treeEntries = [];
    for (const file of files) {
      const blob = await api(token, 'POST', `/repos/${repo}/git/blobs`, {
        content: file.content,
        encoding: 'utf-8',
      });
      treeEntries.push({ path: `${dir}/${file.name}`, mode: '100644', type: 'blob', sha: blob.sha });
    }
    for (const name of toDelete) {
      treeEntries.push({ path: `${dir}/${name}`, mode: '100644', type: 'blob', sha: null });
    }

    const newTree = await api(token, 'POST', `/repos/${repo}/git/trees`, {
      base_tree: headCommit.tree.sha,
      tree: treeEntries,
    });

    const commit = await api(token, 'POST', `/repos/${repo}/git/commits`, {
      message: `Guardar workspace de la sala "${room}" (${files.length} archivo${files.length === 1 ? '' : 's'}) desde el editor colaborativo`,
      tree: newTree.sha,
      parents: [headSha],
      author: { name: authorName || 'Editor colaborativo', email: 'editor-colaborativo@users.noreply.github.com' },
    });

    await api(token, 'PATCH', `/repos/${repo}/git/refs/heads/${branch}`, { sha: commit.sha });

    return { ok: true, dir, branch, commitUrl: commit.html_url };
  } catch (err) {
    return { ok: false, message: err.message || 'Error inesperado guardando en GitHub.' };
  }
}
