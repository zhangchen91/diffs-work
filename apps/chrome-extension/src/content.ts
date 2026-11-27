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
