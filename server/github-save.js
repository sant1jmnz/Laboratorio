const API = 'https://api.github.com';

function config() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO; // "owner/repo"
  const branch = process.env.GITHUB_SAVE_BRANCH || 'code-saves';
  return { token, repo, branch, enabled: Boolean(token && repo) };
}

function pathForRoom(room) {
  const slug = room.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100) || 'general';
  return `saves/${slug}.cpp`;
}

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'editor-colaborativo',
  };
}

async function ensureBranch({ token, repo, branch }) {
  const check = await fetch(`${API}/repos/${repo}/git/ref/heads/${branch}`, { headers: headers(token) });
  if (check.ok) return;

  const repoInfo = await fetch(`${API}/repos/${repo}`, { headers: headers(token) }).then((r) => r.json());
  const defaultBranch = repoInfo.default_branch || 'main';
  const baseRef = await fetch(`${API}/repos/${repo}/git/ref/heads/${defaultBranch}`, {
    headers: headers(token),
  }).then((r) => r.json());

  await fetch(`${API}/repos/${repo}/git/refs`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseRef.object.sha }),
  });
}

export function isConfigured() {
  return config().enabled;
}

export async function loadSavedCode(room) {
  const { token, repo, branch, enabled } = config();
  if (!enabled) return null;

  const path = pathForRoom(room);
  const res = await fetch(
    `${API}/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
    { headers: headers(token) }
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.content) return null;
  return Buffer.from(data.content, 'base64').toString('utf8');
}

export async function saveCode(room, code, authorName) {
  const { token, repo, branch, enabled } = config();
  if (!enabled) {
    return { ok: false, message: 'El guardado en GitHub no esta configurado en el servidor.' };
  }

  try {
    await ensureBranch({ token, repo, branch });

    const path = pathForRoom(room);
    const existing = await fetch(
      `${API}/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
      { headers: headers(token) }
    );
    const sha = existing.ok ? (await existing.json()).sha : undefined;

    const res = await fetch(`${API}/repos/${repo}/contents/${path}`, {
      method: 'PUT',
      headers: headers(token),
      body: JSON.stringify({
        message: `Guardar ${path} (sala "${room}") desde el editor colaborativo`,
        content: Buffer.from(code, 'utf8').toString('base64'),
        branch,
        sha,
        committer: { name: authorName || 'Editor colaborativo', email: 'editor-colaborativo@users.noreply.github.com' },
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { ok: false, message: err.message || `GitHub respondio ${res.status}` };
    }

    const data = await res.json();
    return { ok: true, path, branch, commitUrl: data.commit?.html_url };
  } catch (err) {
    return { ok: false, message: err.message || 'Error inesperado guardando en GitHub.' };
  }
}
