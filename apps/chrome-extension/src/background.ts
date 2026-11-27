/**
 * diffs.work — MV3 service worker.
 *
 * Two things a person can do here:
 *   1. right-click two links      → remember both, open the local diffs viewer
 *   2. right-click a selection    → remember two selections, then compare them
 *                                   in the website inside a local Blob URL
 *
 * Nothing is uploaded. The site is a static bundle; the only network calls are
 * (a) loading https://diffs.work itself and (b) an optional loopback hand-off
 * to `diffs local` (127.0.0.1), which the user starts.
 */
const DEFAULT_LOCAL = "http://127.0.0.1:5279";
/**
 * The site the extension hands off to. `diffs.work` has no DNS record yet, so a custom
 * domain in the constant meant every compare click opened a page that would not load.
 * The deployment URL always works; a custom domain can be set later in one place.
 */
const SITE = "https://www.diffs.work";
/** Set once DNS for the custom domain is live. */
const SITE_CUSTOM = "https://www.diffs.work";

const MENUS = {
  linkPick: "diffs-link-pick",
  linkOpen: "diffs-link-open",
  selPick: "diffs-sel-pick",
  selCompare: "diffs-sel-compare",
  fileSpot: "diffs-file-open",
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENUS.linkPick,
      title: "diffs.work：记住左侧文件",
      contexts: ["link"],
    });
    chrome.contextMenus.create({
      id: MENUS.linkOpen,
      title: "diffs.work：和左侧文件对比",
      contexts: ["link"],
    });
    chrome.contextMenus.create({
      id: MENUS.selPick,
      title: "diffs.work：记住这段选中文字",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: MENUS.selCompare,
      title: "diffs.work：对比两段选中文字",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: MENUS.fileSpot,
      title: "diffs.work：打开本地对比页",
      contexts: ["page"],
    });
  });
});

async function getLocalBase(): Promise<string> {
  const { localBase } = await chrome.storage.sync.get({ localBase: DEFAULT_LOCAL });
  return String(localBase || DEFAULT_LOCAL).replace(/\/$/, "");
}

async function setBadge(text: string, color: string): Promise<void> {
  try {
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 4000);
  } catch {
    /* no badge in some contexts */
  }
}

async function notify(title: string, message: string): Promise<void> {
  try {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title,
      message,
    });
  } catch {
    await setBadge("!", "#d29922");
  }
}

async function rememberSwitch(key: string, value: unknown): Promise<unknown> {
  const all = await chrome.storage.session.get([key]);
  const prev = all[key];
  await chrome.storage.session.set({ [`${key}Prev`]: prev ?? null, [key]: value });
  return prev;
}

/** Open the local viewer on the two remembered links; if no local server, open the site. */
async function openLinkPair() {
  const { link, linkPrev } = await chrome.storage.session.get(["link", "linkPrev"]);
  if (!link || !linkPrev) {
    await notify("diffs.work", "先「记住左侧文件」，再在第二个链接上「和左侧文件对比」。");
    return;
  }
  const base = await getLocalBase();
  const payload = {
    title: `${short(linkPrev)} → ${short(link)}`,
    old: { label: short(linkPrev), path: linkPrev },
    new: { label: short(link), path: link },
    source: "chrome-extension",
  };
  try {
    const res = await fetch(`${base}/api/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(1500),
    });
    if (res.ok) {
      const { url } = await res.json();
      await chrome.tabs.create({ url: `${base}${url}` });
      return;
    }
  } catch {
    /* fall through to the site */
  }
  await chrome.tabs.create({ url: `${SITE}/#/inbox?local=${encodeURIComponent(base)}` });
  await notify("diffs.work", "本地站未启动：已打开官网。运行 `diffs local` 可本地查看这两个链接。");
}

function short(u: unknown): string {
  try {
    const url = new URL(String(u));
    return `${url.host}${url.pathname}`.slice(0, 80);
  } catch {
    return String(u).slice(0, 80);
  }
}

/** Compare two remembered selections in the website (data lives in the extension, not on a server). */
async function openSelectionPair(tabId?: number) {
  const { selection, selectionPrev } = await chrome.storage.session.get(["selection", "selectionPrev"]);
  if (!selection || !selectionPrev) {
    await notify("diffs.work", "先选中一段并「记住」，再选中第二段点「对比两段选中文字」。");
    return;
  }
  // The page the person is reading, when it can draw. A tab only when it cannot.
  if (await showInline(selectionPrev, selection, "选中两段文字", tabId)) {
    await setBadge("✓", "#3fb950");
    return;
  }
  await openCompareFromTexts(selectionPrev, selection, "selection");
}

/**
 * The website compare page accepts ?text=… payloads only through a hash and a
 * chrome.storage hand-off, so long selections never reach the URL bar.
 */
/**
 * Show the comparison where the person is, falling back to a tab only when that is impossible.
 *
 * Opening a tab was the whole behaviour, and it is what "还得额外点到本地站" meant: two selections
 * on a page, and the page you were reading disappears behind a new one. The content script draws
 * into the page instead; a tab remains the answer for pages that will not run content scripts
 * (chrome://, the Web Store, PDF viewers) and for the link-a-file flows, which need the full views.
 */
async function showInline(oldText: string, newText: string, label: string, tabId?: number): Promise<boolean> {
  if (tabId == null) return false;
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: "content:showPair", oldText, newText, label });
    return Boolean(res?.ok);
  } catch {
    // No content script on this tab: a restricted page, or one that loaded before install.
    return false;
  }
}

async function openCompareFromTexts(oldText: string, newText: string, label: string): Promise<void> {
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [`pair:${id}`]: { oldText, newText, label, at: Date.now() } });
  // Prefer the local site: it runs with every engine the extension needs and works with no
  // account or deployment. The hosted site is the fallback, and its compare page reads the
  // pair through the content script bridge (a page cannot touch chrome.storage itself).
  const local = await getLocalBase();
  let target = `${SITE}/#/compare?pair=${id}`;
  try {
    const res = await fetch(`${local}/health`, { signal: AbortSignal.timeout(800) });
    if (res.ok) target = `${local}/#/compare?pair=${id}`;
  } catch {
    /* local viewer not running */
  }
  await chrome.tabs.create({ url: target });
  await setBadge("→", "#3fb950");
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  switch (info.menuItemId) {
    case MENUS.linkPick: {
      const prev = await rememberSwitch("link", info.linkUrl);
      await setBadge(prev ? "①②" : "①", "#38bdf8");
      await notify("diffs.work", `已记住左侧：${short(info.linkUrl)}`);
      break;
    }
    case MENUS.linkOpen:
      await openLinkPair();
      break;
    case MENUS.selPick: {
      const prev = await rememberSwitch("selection", info.selectionText ?? "");
      await setBadge(prev ? "①②" : "①", "#38bdf8");
      break;
    }
    case MENUS.selCompare:
      await openSelectionPair(tab?.id);
      break;
    case MENUS.fileSpot: {
      const base = await getLocalBase();
      await chrome.tabs.create({ url: `${base}/#/compare` }).catch(() => chrome.tabs.create({ url: `${SITE}/#/compare` }));
      break;
    }
    default:
      break;
  }
});

/** The popup and the content script talk to the worker through these messages. */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "pair:compare": {
        await openCompareFromTexts(message.oldText ?? "", message.newText ?? "", message.label ?? "popup");
        sendResponse({ ok: true });
        break;
      }
      case "pair:store": {
        const id = message.id ?? crypto.randomUUID();
        await chrome.storage.local.set({ [`pair:${id}`]: { ...message.pair, at: Date.now() } });
        sendResponse({ ok: true, id });
        break;
      }
      case "local:base": {
        sendResponse({ ok: true, base: await getLocalBase() });
        break;
      }
      case "local:inbox": {
        const base = await getLocalBase();
        try {
          const res = await fetch(`${base}/api/inbox`, { signal: AbortSignal.timeout(1200) });
          sendResponse({ ok: res.ok, items: res.ok ? (await res.json()).items ?? [] : [] });
        } catch {
          sendResponse({ ok: false, items: [] });
        }
        break;
      }
      default:
        sendResponse({ ok: false });
    }
  })();
  return true; // async response
});

// Test surface: only attached outside the extension bundle (see the build's `define`).
// A service worker must not contain module exports, so this cannot be a real `export`.
(globalThis as Record<string, unknown>).__diffsExtensionTest = { MENUS, short, DEFAULT_LOCAL, SITE };