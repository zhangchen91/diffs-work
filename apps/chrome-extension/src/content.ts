/**
 * diffs.work content script.
 *
 * Two jobs:
 *
 * 1. Collect the two most recent non-empty selections so the popup can compare them
 *    (memory only — nothing leaves the page).
 * 2. Draw a comparison in this page, when the background half asks (see `inline-panel.ts`).
 *
 * 3. Bridge the extension's stored pairs to the compare page. The page cannot read
 *    `chrome.storage` itself: that API belongs to the extension's world, not the site's,
 *    so a `?pair=<id>` URL opened the compare page with nothing in it. The page asks by
 *    postMessage and this script answers with the pair it stored.
 */
import { showPanel } from "./inline-panel";
import { GITHUB_STYLES, annotateGithubDiff, isGithubDiffPage } from "./github-diff";

(() => {
  const state: { selections: string[] } = { selections: [] };
  // A marker in the page the script is running on, so a test can tell "the script never loaded"
  // from "the script loaded and the panel failed". The message API gives neither answer.
  document.documentElement.setAttribute("data-diffs-work", "1");

  document.addEventListener("mouseup", () => {
    const text = String(window.getSelection?.() ?? "").trim();
    if (text.length < 2) return;
    if (state.selections[1] === text) return;
    state.selections = [state.selections[1], text].filter((v): v is string => Boolean(v)).slice(-2);
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "content:selections") {
      sendResponse({ ok: true, selections: state.selections });
    }
    // Drawn here, in the page the person is reading, instead of opening a tab and losing the
    // scroll position that made the two selections worth comparing.
    if (msg?.type === "content:showPair" && msg.oldText && msg.newText) {
      showPanel({
        oldText: String(msg.oldText),
        newText: String(msg.newText),
        label: String(msg.label ?? "对比"),
        localUrl: typeof msg.localUrl === "string" ? msg.localUrl : undefined,
      });
      sendResponse({ ok: true, inline: true });
    }
    return false;
  });

  // ── GitHub commits: annotate, do not ask ────────────────────────────────────────────────
  //
  // A diff plugin that waits for a right-click is a bookmarklet. On a commit page the diff is
  // already on screen, so the extension marks the words that changed inside GitHub's own rows as
  // soon as they exist. GitHub re-renders those rows as you scroll (its diff is virtualised), so a
  // MutationObserver re-runs the pass; the marker attribute makes it idempotent.
  if (isGithubDiffPage(location.href)) {
    const style = document.createElement("style");
    style.textContent = GITHUB_STYLES;
    (document.head ?? document.documentElement).appendChild(style);

    const run = (): void => {
      try {
        annotateGithubDiff(document);
      } catch {
        // A page whose markup this version does not recognise must not break the page.
      }
    };
    run();
    const observer = new MutationObserver(() => run());
    observer.observe(document.body, { childList: true, subtree: true });
    // GitHub swaps the whole page on in-app navigation; the stylesheet and observer do not survive.
    window.addEventListener("turbo:load", run);
    window.addEventListener("pjax:end", run);
  }

  const ASK = "diffs-work:pair:request";
  const ANSWER = "diffs-work:pair:response";

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== ASK || typeof data.id !== "string") return;
    const key = `pair:${data.id}`;
    chrome.storage.local.get([key], (store) => {
      const pair = store[key] as
        | { oldText?: string; newText?: string; oldName?: string; newName?: string }
        | undefined;
      window.postMessage({ type: ANSWER, id: data.id, pair: pair ?? null }, "*");
    });
  });
})();
