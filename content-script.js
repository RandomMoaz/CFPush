
(() => {
  const LOG = (...a) => console.debug("[CFPush]", ...a);

  // --- storage helpers ------------------------------------------------------
  const PENDING_KEY = "cfpush_pending"; // { [subId]: payload } OR { __latest: payload }

  function storageGet(key) {
    return new Promise((res) =>
      chrome.storage.local.get([key], (v) => res(v[key]))
    );
  }
  function storageSet(obj) {
    return new Promise((res) => chrome.storage.local.set(obj, res));
  }

  async function stashPending(payload) {
    const all = (await storageGet(PENDING_KEY)) || {};
    // We don't know the submission id yet (CF assigns it server-side), so we
    // stash under __latest keyed by (contestId, index, submittedAt). The
    // submissions page will match it to the newest row.
    all.__latest = { ...payload, submittedAt: Date.now() };
    await storageSet({ [PENDING_KEY]: all });
  }

  async function takePendingFor(contestId, problemIndex) {
    const all = (await storageGet(PENDING_KEY)) || {};
    const latest = all.__latest;
    if (!latest) return null;
    if (
      String(latest.contestId) === String(contestId) &&
      latest.problemIndex === problemIndex
    ) {
      // consume it
      delete all.__latest;
      await storageSet({ [PENDING_KEY]: all });
      return latest;
    }
    return null;
  }

  // --- page type detection --------------------------------------------------
  const url = new URL(location.href);
  const path = url.pathname;

  const isSubmitPage =
    /\/(contest|gym)\/\d+\/submit/.test(path) ||
    path === "/problemset/submit" ||
    /\/problemset\/submit\/\d+\/.+/.test(path);

  const isSubmissionsPage =
    /\/(contest|gym)\/\d+\/my/.test(path) ||
    /\/submissions\/[^/]+/.test(path) ||
    /\/(contest|gym)\/\d+\/status/.test(path);

  // --- 1) SUBMIT PAGE: capture ---------------------------------------------
  if (isSubmitPage) {
    const form = document.querySelector("form.submit-form, form[id*='submit']");
    if (form) {
      form.addEventListener(
        "submit",
        async () => {
          try {
            // Source: Codeforces uses a plain <textarea name="source"> which
            // is mirrored from Ace if it's in use, so reading the textarea
            // at submit time is reliable.
            const sourceEl = form.querySelector(
              "textarea[name='source'], textarea#sourceCodeTextarea"
            );
            const langEl = form.querySelector(
              "select[name='programTypeId']"
            );
            const probEl = form.querySelector(
              "select[name='submittedProblemIndex'], input[name='submittedProblemIndex']"
            );

            const code = sourceEl ? sourceEl.value : "";
            const langId = langEl ? langEl.value : "";

            // Contest id comes from the URL; problem index from the select.
            const m = path.match(/\/(?:contest|gym)\/(\d+)/);
            const contestId = m
              ? m[1]
              : (new URLSearchParams(location.search).get("contestId") || "");

            let problemIndex = probEl ? probEl.value : "";
            // Problemset submit pages embed the index in the URL too.
            const m2 = path.match(/\/problemset\/submit\/(\d+)\/([^/]+)/);
            if (m2 && !problemIndex) problemIndex = m2[2];

            if (!code || !contestId || !problemIndex) {
              LOG("capture skipped, missing fields", {
                code: !!code,
                contestId,
                problemIndex,
              });
              return;
            }

            await stashPending({
              code,
              langId,
              contestId,
              problemIndex,
              sourceUrl: location.href,
            });
            LOG("captured submission", contestId, problemIndex, "lang", langId);
          } catch (e) {
            LOG("capture error", e);
          }
        },
        true
      );
    }
  }

  // --- 2) SUBMISSIONS PAGE: inject Push buttons -----------------------------
  if (isSubmissionsPage) {
    const seen = new Set(); // submission ids we've already decorated

    function findSubmissionRows() {
      return document.querySelectorAll(
        "tr[data-submission-id], tr.highlighted-row[data-submission-id]"
      );
    }

    function verdictOf(row) {
      const cell = row.querySelector("td.status-cell, td.status-small, td.status-verdict-cell");
      if (!cell) return "";
      return (cell.textContent || "").trim();
    }

    function problemRefOf(row) {
      // The problem cell holds <a href="/contest/1234/problem/B">...</a>
      const a = row.querySelector("td a[href*='/problem/']");
      if (!a) return null;
      const m = a.getAttribute("href").match(/\/(?:contest|gym)\/(\d+)\/problem\/([^/?#]+)/);
      if (!m) return null;
      return { contestId: m[1], problemIndex: m[2], title: (a.textContent || "").trim() };
    }

    async function decorate(row) {
      const subId = row.getAttribute("data-submission-id");
      if (!subId || seen.has(subId)) return;
      const verdict = verdictOf(row);
      if (!/Accepted/i.test(verdict)) return;

      const prob = problemRefOf(row);
      if (!prob) return;

      seen.add(subId);

      // Find a cell to put the button in -- the last cell is usually actions.
      const cells = row.querySelectorAll("td");
      const host = cells[cells.length - 1] || row;

      const btn = document.createElement("button");
      btn.textContent = "Push";
      btn.className = "cfpush-btn";
      btn.title = "Push this accepted solution to GitHub";
      Object.assign(btn.style, {
        marginLeft: "6px",
        padding: "2px 8px",
        border: "1px solid #c0392b",
        background: "#fff",
        color: "#c0392b",
        borderRadius: "3px",
        cursor: "pointer",
        font: "500 11px/1.2 -apple-system, system-ui, sans-serif",
      });
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        btn.disabled = true;
        btn.textContent = "Pushing...";
        try {
          const payload = await buildPayload(subId, prob);
          if (!payload) {
            btn.textContent = "No code captured";
            btn.style.color = "#888";
            return;
          }
          const resp = await chrome.runtime.sendMessage({
            type: "CFPUSH_PUSH",
            payload,
          });
          if (resp && resp.ok) {
            btn.textContent = "✓ Pushed";
            btn.style.color = "#27ae60";
            btn.style.borderColor = "#27ae60";
          } else {
            btn.textContent = "Error";
            btn.style.color = "#c0392b";
            btn.title = (resp && resp.error) || "Unknown error";
            console.error("[CFPush]", resp);
          }
        } catch (e) {
          btn.textContent = "Error";
          btn.title = String(e);
          console.error("[CFPush]", e);
        }
      });
      host.appendChild(btn);
    }

    async function buildPayload(subId, prob) {
      // Prefer the code we captured at submit time. If the user refreshed or
      // opened the page in a new tab, we fall back to scraping the submission
      // source page.
      const pending = await takePendingFor(prob.contestId, prob.problemIndex);
      if (pending) {
        return {
          submissionId: subId,
          contestId: prob.contestId,
          problemIndex: prob.problemIndex,
          problemTitle: prob.title,
          code: pending.code,
          langId: pending.langId,
          sourceUrl: `https://codeforces.com/contest/${prob.contestId}/submission/${subId}`,
        };
      }
      // Fallback: fetch the submission page and scrape <pre id="program-source-text">.
      try {
        const r = await fetch(
          `https://codeforces.com/contest/${prob.contestId}/submission/${subId}`,
          { credentials: "include" }
        );
        const html = await r.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        const pre = doc.querySelector("pre#program-source-text");
        const code = pre ? pre.textContent : "";
        // Language label is rendered in the submission page's info table.
        const langCell = Array.from(doc.querySelectorAll("table.info-table td, table td")).find(
          (td) => /GNU|Clang|Python|Java|Kotlin|PyPy|Rust|Go|C#/i.test(td.textContent || "")
        );
        const langName = langCell ? langCell.textContent.trim() : "";
        return {
          submissionId: subId,
          contestId: prob.contestId,
          problemIndex: prob.problemIndex,
          problemTitle: prob.title,
          code,
          langId: "", // unknown; background will use langName
          langName,
          sourceUrl: `https://codeforces.com/contest/${prob.contestId}/submission/${subId}`,
        };
      } catch (e) {
        LOG("fallback scrape failed", e);
        return null;
      }
    }

    function scan() {
      findSubmissionRows().forEach(decorate);
    }

    scan();
    // Codeforces updates verdicts live via Ajax; observe the table for changes.
    const mo = new MutationObserver(() => scan());
    const body =
      document.querySelector("table.status-frame-datatable") ||
      document.body;
    mo.observe(body, { childList: true, subtree: true, characterData: true });
  }
})();
