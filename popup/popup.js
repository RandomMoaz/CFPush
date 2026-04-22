const FIELDS = ["token", "owner", "repo", "branch", "rootDir"];
const statusEl = document.getElementById("status");

function setStatus(msg, kind) {
  statusEl.textContent = msg || "";
  statusEl.className = "status" + (kind ? " " + kind : "");
}

async function load() {
  const data = await chrome.storage.local.get(FIELDS);
  for (const f of FIELDS) {
    const el = document.getElementById(f);
    if (!el) continue;
    if (data[f]) el.value = data[f];
  }
  // sensible defaults for empty fields
  if (!document.getElementById("branch").value) {
    document.getElementById("branch").placeholder = "main";
  }
  if (!document.getElementById("rootDir").value) {
    document.getElementById("rootDir").placeholder = "codeforces";
  }
}

async function save() {
  const values = {};
  for (const f of FIELDS) {
    const el = document.getElementById(f);
    values[f] = el ? el.value.trim() : "";
  }
  if (!values.token || !values.owner || !values.repo) {
    setStatus("Token, owner, and repo are required.", "err");
    return;
  }
  await chrome.storage.local.set(values);
  setStatus("Saved.", "ok");
}

async function testConn() {
  setStatus("Testing…");
  const resp = await chrome.runtime.sendMessage({ type: "CFPUSH_TEST_TOKEN" });
  if (resp && resp.ok) {
    setStatus(`OK — ${resp.repo} (default: ${resp.branch})`, "ok");
  } else {
    setStatus((resp && resp.error) || "Failed.", "err");
  }
}

document.getElementById("save").addEventListener("click", save);
document.getElementById("test").addEventListener("click", testConn);
document.addEventListener("DOMContentLoaded", load);
