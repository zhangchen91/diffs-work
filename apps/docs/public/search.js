/**
 * Search for the docs, entirely in the page.
 *
 * The index is one JSON file fetched on first use; matching is a linear scan over 50 pages with a
 * small scoring function. Nothing is sent anywhere — the same rule the product itself follows —
 * and at this size a full-text engine would be the wrong amount of machinery.
 *
 * Opened with `/` or Ctrl/Cmd+K, closed with Escape.
 */
const root = document.querySelector('[data-docs-search]');
const input = root?.querySelector("input") ?? null;
const list = root?.querySelector("[data-results]") ?? null;
const toggle = document.querySelector("[data-search-open]");

let pages = null;
const lang = document.documentElement.lang.startsWith('en') ? 'en' : 'zh';

async function load() {
  if (pages) return pages;
  const res = await fetch('/search-index.json');
  const data = await res.json();
  pages = data.pages;
  return pages;
}

/** Where the query appears in the page text, with a little context around it. */
function snippetFor(page, q) {
  const hay = page.text.toLowerCase();
  const at = hay.indexOf(q);
  if (at < 0) return page.description;
  const from = Math.max(0, at - 40);
  const to = Math.min(page.text.length, at + q.length + 60);
  return `${from > 0 ? "…" : ""}${page.text.slice(from, to)}${to < page.text.length ? "…" : ""}`;
}

function score(page, q) {
  const t = page.title.toLowerCase();
  const d = page.description.toLowerCase();
  const h = page.headings.join(" ").toLowerCase();
  const b = page.text.toLowerCase();
  let s = 0;
  if (t === q) s += 100;
  if (t.includes(q)) s += 40;
  if (h.includes(q)) s += 16;
  if (d.includes(q)) s += 10;
  if (b.includes(q)) s += 4;
  return s;
}

function highlight(text, q) {
  if (!q) return escapeHtml(text);
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return escapeHtml(text);
  return (
    escapeHtml(text.slice(0, i)) +
    `<mark class="rounded bg-[#6ee7b7]/25 px-0.5 text-white">${escapeHtml(text.slice(i, i + q.length))}</mark>` +
    escapeHtml(text.slice(i + q.length))
  );
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

function render(hits, q) {
  if (!list) return;
  if (!q) {
    list.innerHTML = `<div class="px-3 py-6 text-[12.5px] text-slate-500">${
      lang === "en" ? "Type to search the docs" : "输入关键词搜索文档"
    }</div>`;
    return;
  }
  if (!hits.length) {
    list.innerHTML = `<div class="px-3 py-6 text-[12.5px] text-slate-500">${
      lang === "en" ? `No page matches “${escapeHtml(q)}”` : `没有页面匹配「${escapeHtml(q)}」`
    }</div>`;
    return;
  }
  list.innerHTML = hits
    .map(
      (h) => `<a href="${h.page.url}" class="block border-b border-[#1e222d] px-3 py-2.5 hover:bg-[#0b0d13]">
        <div class="text-[13px] font-medium text-white">${highlight(h.page.title, q)}</div>
        <div class="mt-0.5 text-[11px] uppercase tracking-[0.14em] text-slate-600">${escapeHtml(h.page.group)}</div>
        <div class="mt-1 line-clamp-2 text-[12px] leading-5 text-slate-500">${highlight(h.snippet, q)}</div>
      </a>`,
    )
    .join("");
}

let index = 0;

async function search(q) {
  const all = await load();
  const query = q.trim().toLowerCase();
  const mine = all.filter((p) => p.lang === lang);
  if (!query) return render([], "");
  const hits = mine
    .map((page) => ({ page, score: score(page, query), snippet: snippetFor(page, query) }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
  index = 0;
  render(hits, query);
  if (list) list.querySelectorAll('a').forEach((a, i) => {
    if (i === index) a.classList.add("bg-[#0b0d13]");
  });
}

function open() {
  if (!root) return;
  root.hidden = false;
  input?.focus();
  input?.select();
}

function close() {
  if (root) root.hidden = true;
}

toggle?.addEventListener("click", open);
root?.addEventListener("click", (e) => {
  if (e.target === root) close();
});
input?.addEventListener("input", () => void search(input.value));
input?.addEventListener("keydown", (e) => {
  const links = list ? list.querySelectorAll('a') : [];
  if (e.key === "Escape") {
    close();
    return;
  }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!links.length) return;
    links[index]?.classList.remove("bg-[#0b0d13]");
    index = (index + (e.key === "ArrowDown" ? 1 : -1) + links.length) % links.length;
    links[index]?.classList.add("bg-[#0b0d13]");
    links[index]?.scrollIntoView({ block: "nearest" });
    return;
  }
  if (e.key === "Enter" && links[index]) {
    e.preventDefault();
    links[index].click();
  }
});

document.addEventListener("keydown", (e) => {
  const typing = e.target && e.target.tagName;
  if (typing === "INPUT" || typing === "TEXTAREA") return;
  if (e.key === "/" || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) {
    e.preventDefault();
    open();
  }
});
// Marker so an integration check can tell "the script ran" from "the script 404'd".
window.__docsSearch = true;
