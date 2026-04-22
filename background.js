// background.js
// Service worker. Receives CFPUSH_PUSH messages from the content script and
// commits two files to the user's configured GitHub repo: the solution and
// a README.md with the problem metadata.

import { cfLangInfo } from "./lib/langs.js";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "CFPUSH_PUSH") {
    handlePush(msg.payload).then(
      (result) => sendResponse({ ok: true, ...result }),
      (err) => sendResponse({ ok: false, error: String(err && err.message || err) })
    );
    return true; // keep the message channel open for async response
  }
  if (msg && msg.type === "CFPUSH_TEST_TOKEN") {
    testToken().then(
      (r) => sendResponse({ ok: true, ...r }),
      (e) => sendResponse({ ok: false, error: String(e && e.message || e) })
    );
    return true;
  }
});

async function getConfig() {
  const cfg = await chrome.storage.local.get([
    "token",
    "owner",
    "repo",
    "branch",
    "rootDir",
  ]);
  if (!cfg.token || !cfg.owner || !cfg.repo) {
    throw new Error("Not configured. Open the CFPush popup and set token + owner + repo.");
  }
  return {
    token: cfg.token,
    owner: cfg.owner,
    repo: cfg.repo,
    branch: cfg.branch || "main",
    rootDir: (cfg.rootDir || "codeforces").replace(/^\/+|\/+$/g, ""),
  };
}

async function handlePush(payload) {
  const cfg = await getConfig();
  const { contestId, problemIndex, problemTitle, code } = payload;
  if (!code) throw new Error("No source code captured for this submission.");

  // Figure out file extension from the captured language id (or fallback to
  // the language name text we scraped).
  let info = cfLangInfo(payload.langId);
  if (info.ext === "txt" && payload.langName) {
    info = guessByName(payload.langName);
  }

  // Optionally enrich with rating + tags from the Codeforces API.
  const meta = await fetchProblemMeta(contestId, problemIndex).catch(() => null);

  const slug = slugify(problemTitle || (meta && meta.name) || `${contestId}${problemIndex}`);
  const ratingDir = meta && meta.rating ? String(meta.rating) : "unrated";
  const folder = `${cfg.rootDir}/${ratingDir}/${contestId}${problemIndex}-${slug}`;

  const solutionPath = `${folder}/solution.${info.ext}`;
  const readmePath = `${folder}/README.md`;

  const readme = buildReadme({
    contestId,
    problemIndex,
    title: problemTitle || (meta && meta.name) || `${contestId}${problemIndex}`,
    rating: meta && meta.rating,
    tags: (meta && meta.tags) || [],
    langName: info.name,
    submissionId: payload.submissionId,
  });

  const commitMsg =
    `Solve ${contestId}${problemIndex}` +
    (problemTitle ? ` - ${problemTitle}` : "") +
    (meta && meta.rating ? ` (${meta.rating})` : "");

  await putContents(cfg, solutionPath, code, commitMsg);
  await putContents(cfg, readmePath, readme, `docs: ${commitMsg}`);

  return { path: solutionPath };
}

// ---- GitHub API -------------------------------------------------------------

async function putContents(cfg, path, content, message) {
  const api = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURI(path)}`;

  // Check whether the file already exists so we can pass its sha (required
  // for updates; absent for creates).
  let sha;
  const head = await fetch(`${api}?ref=${encodeURIComponent(cfg.branch)}`, {
    headers: ghHeaders(cfg.token),
  });
  if (head.ok) {
    const j = await head.json();
    sha = j.sha;
  } else if (head.status !== 404) {
    throw new Error(`GitHub GET failed (${head.status}): ${await head.text()}`);
  }

  const body = {
    message,
    content: b64encode(content),
    branch: cfg.branch,
  };
  if (sha) body.sha = sha;

  const r = await fetch(api, {
    method: "PUT",
    headers: { ...ghHeaders(cfg.token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    throw new Error(`GitHub PUT failed (${r.status}): ${await r.text()}`);
  }
  return r.json();
}

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function testToken() {
  const cfg = await getConfig();
  const r = await fetch(
    `https://api.github.com/repos/${cfg.owner}/${cfg.repo}`,
    { headers: ghHeaders(cfg.token) }
  );
  if (!r.ok) throw new Error(`GitHub says ${r.status}`);
  const j = await r.json();
  return { repo: j.full_name, branch: j.default_branch };
}

// ---- Codeforces API ---------------------------------------------------------

const metaCache = new Map();
async function fetchProblemMeta(contestId, index) {
  const key = `${contestId}-${index}`;
  if (metaCache.has(key)) return metaCache.get(key);
  const r = await fetch(
    `https://codeforces.com/api/contest.standings?contestId=${contestId}&from=1&count=1`
  );
  if (!r.ok) return null;
  const j = await r.json();
  if (j.status !== "OK") return null;
  const prob = (j.result.problems || []).find((p) => p.index === index);
  if (!prob) return null;
  const meta = { name: prob.name, rating: prob.rating, tags: prob.tags || [] };
  metaCache.set(key, meta);
  return meta;
}

// ---- helpers ----------------------------------------------------------------

function buildReadme({ contestId, problemIndex, title, rating, tags, langName, submissionId }) {
  const url = `https://codeforces.com/contest/${contestId}/problem/${problemIndex}`;
  const subUrl = `https://codeforces.com/contest/${contestId}/submission/${submissionId}`;
  const lines = [
    `# ${contestId}${problemIndex} — ${title}`,
    ``,
    `- Problem: [${url}](${url})`,
    `- Submission: [${subUrl}](${subUrl})`,
  ];
  if (rating) lines.push(`- Rating: **${rating}**`);
  if (tags && tags.length) lines.push(`- Tags: ${tags.map((t) => `\`${t}\``).join(", ")}`);
  if (langName) lines.push(`- Language: ${langName}`);
  lines.push(``, `_Pushed by CFPush._`, ``);
  return lines.join("\n");
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "problem";
}

// UTF-8 safe base64 for GitHub (content must be base64-encoded UTF-8).
function b64encode(str) {
  // btoa only handles latin-1; round-trip via TextEncoder for Unicode safety.
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function guessByName(name) {
  const n = name.toLowerCase();
  if (/python|pypy/.test(n)) return { ext: "py", name, md: "python" };
  if (/g\+\+|clang|c\+\+/.test(n)) return { ext: "cpp", name, md: "cpp" };
  if (/gcc|c11|\bc\b/.test(n)) return { ext: "c", name, md: "c" };
  if (/java/.test(n)) return { ext: "java", name, md: "java" };
  if (/kotlin/.test(n)) return { ext: "kt", name, md: "kotlin" };
  if (/rust/.test(n)) return { ext: "rs", name, md: "rust" };
  if (/go\b/.test(n)) return { ext: "go", name, md: "go" };
  if (/c#|\.net/.test(n)) return { ext: "cs", name, md: "csharp" };
  if (/javascript|node/.test(n)) return { ext: "js", name, md: "javascript" };
  if (/typescript/.test(n)) return { ext: "ts", name, md: "typescript" };
  if (/ruby/.test(n)) return { ext: "rb", name, md: "ruby" };
  if (/pascal/.test(n)) return { ext: "pas", name, md: "pascal" };
  if (/haskell/.test(n)) return { ext: "hs", name, md: "haskell" };
  return { ext: "txt", name, md: "" };
}
