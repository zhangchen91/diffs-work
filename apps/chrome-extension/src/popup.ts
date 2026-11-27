/**
 * Popup: pick two files (or paste two texts) and open the diffs.work compare
 * page. The files never leave the browser: they are written into a local
 * IndexedDB-like store of the extension (chrome.storage.local is size-limited,
 * so large blobs go through an object URL in the tab instead).
 */
function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`popup: missing #${id}`);
  return el as T;
}

const state: { f1: File | null; f2: File | null; localBase: string } = { f1: null, f2: null, localBase: "http://127.0.0.1:5279" };

async function init() {
  const { base } = await chrome.runtime.sendMessage({ type: "local:base" });
  state.localBase = base || state.localBase;
  $<HTMLInputElement>("localBase").value = state.localBase;

  $<HTMLInputElement>("localBase").addEventListener("change", async () => {
    state.localBase = $<HTMLInputElement>("localBase").value.trim() || "http://127.0.0.1:5279";
    await chrome.storage.sync.set({ localBase: state.localBase });
  });

  $<HTMLInputElement>("f1").addEventListener("change", (e) => (state.f1 = (e.target as HTMLInputElement).files?.[0] ?? null));
  $<HTMLInputElement>("f2").addEventListener("change", (e) => (state.f2 = (e.target as HTMLInputElement).files?.[0] ?? null));

  $("compare").addEventListener("click", compare);
  $("openLocal").addEventListener("click", () => chrome.tabs.create({ url: `${state.localBase}/#/compare` }));
  $("openInbox").addEventListener("click", () => chrome.tabs.create({ url: `${state.localBase}/#/inbox` }));

  await loadInbox();
}

async function compare() {
  const t1 = $<HTMLTextAreaElement>("t1").value;
  const t2 = $<HTMLTextAreaElement>("t2").value;

  // two files → hand them to the site through the extension's own store
  if (state.f1 && state.f2) {
    const [a, b] = await Promise.all([readFile(state.f1), readFile(state.f2)]);
    const id = await storePair({
      oldText: a.text,
      newText: b.text,
      oldName: state.f1.name,
      newName: state.f2.name,
      oldB64: a.base64,
      newB64: b.base64,
      at: Date.now(),
    });
    await chrome.tabs.create({ url: `https://diffs.work/#/compare?pair=${id}` });
    return;
  }

  // two texts → same route, no base64
  if (t1 || t2) {
    const id = await storePair({
      oldText: t1,
      newText: t2,
      oldName: "pasted-old.txt",
      newName: "pasted-new.txt",
      oldB64: "",
      newB64: "",
      at: Date.now(),
    });
    await chrome.tabs.create({ url: `https://diffs.work/#/compare?pair=${id}` });
    return;
  }

  // one file + nothing else: open the local viewer so the person can pick the second one
  await chrome.tabs.create({ url: `${state.localBase}/#/compare` });
}

interface ReadResult {
  text: string;
  base64: string;
}

function readFile(file: File): Promise<ReadResult> {
  return new Promise<ReadResult>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const result = String(fr.result);
      const comma = result.indexOf(",");
      const base64 = comma >= 0 ? result.slice(comma + 1) : result;
      // large files would blow the message limit; only inline small ones
      const inline = file.size <= 2 * 1024 * 1024;
      resolve({ text: inline ? atob(base64) : "", base64: inline ? base64 : "" });
    };
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

/** Keep the pair in the extension store for the site to pick up by id. */
interface StoredPair {
  oldText: string;
  newText: string;
  oldName: string;
  newName: string;
  oldB64: string;
  newB64: string;
  at: number;
}

async function storePair(pair: StoredPair): Promise<string> {
  const id = crypto.randomUUID();
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith("pair:"));
  // keep the store small: newest 5 pairs
  if (keys.length >= 5) await chrome.storage.local.remove(keys.slice(0, keys.length - 4));
  await chrome.storage.local.set({ [`pair:${id}`]: pair });
  return id;
}

async function loadInbox() {
  const { ok, items } = await chrome.runtime.sendMessage({ type: "local:inbox" });
  const el = $("inbox");
  if (!ok) {
    el.innerHTML = `<div class="hint">本地站未运行（${state.localBase}）</div>`;
    return;
  }
  if (!items?.length) {
    el.innerHTML = `<div class="hint">Inbox 为空</div>`;
    return;
  }
  el.innerHTML = items
    .slice(0, 6)
    .map(
      (it: { title?: string; createdAt: number }) =>
        `<div class="item"><b>${escapeHtml(it.title)}</b><br>${new Date(it.createdAt).toLocaleString()}</div>`,
    )
    .join("");
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

init().catch((e: unknown) => {
  $<HTMLElement>("hint").textContent = `初始化失败：${e instanceof Error ? e.message : String(e)}`;
});