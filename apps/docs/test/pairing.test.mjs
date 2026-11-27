/**
 * Docs are bilingual: every page exists in both languages and covers the same ground.
 *
 * Two English pages had drifted to half the size of their Chinese counterparts — three of six
 * sections missing — and nothing noticed, because each language builds on its own. A shorter
 * translation is not a translation: it is a page that silently says less.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.resolve(HERE, "../src/content/docs");

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.name.endsWith(".mdx")) out.push(p);
  }
  return out;
}

const rel = (p) => p.slice(DOCS.length + 1).replace(/^en\//, "");

test("every page exists in both languages", async () => {
  const all = await walk(DOCS);
  const zh = new Set(all.filter((p) => !p.includes("/en/")).map(rel));
  const en = new Set(all.filter((p) => p.includes("/en/")).map(rel));
  assert.deepEqual([...zh].filter((k) => !en.has(k)), [], "missing English page(s)");
  assert.deepEqual([...en].filter((k) => !zh.has(k)), [], "missing Chinese page(s)");
  assert.ok(zh.size >= 20, `only ${zh.size} pages`);
});

test("the two versions of a page cover the same sections", async () => {
  const all = await walk(DOCS);
  const zhFiles = all.filter((p) => !p.includes("/en/"));
  const drift = [];
  for (const zhPath of zhFiles) {
    const enPath = path.join(DOCS, "en", rel(zhPath));
    let en;
    try {
      en = await readFile(enPath, "utf8");
    } catch {
      continue; // covered by the pairing test above
    }
    const zh = await readFile(zhPath, "utf8");
    const h = (s) => (s.match(/^## /gm) || []).length;
    const code = (s) => (s.match(/```[\s\S]*?```/g) || []).length;
    const dh = Math.abs(h(zh) - h(en));
    const dc = Math.abs(code(zh) - code(en));
    // a section or a code block may legitimately differ; several at once means drift
    if (dh >= 2 || dc >= 2) drift.push(`${rel(zhPath)} — sections ${h(zh)}/${h(en)}, code blocks ${code(zh)}/${code(en)}`);
  }
  assert.deepEqual(drift, [], `pages that say less in one language:\n  ${drift.join("\n  ")}`);
});

test("the docs do not advertise capabilities that were retired", async () => {
  // OCR was removed from the product in round 29 — the kernel never had it. The docs shed the
  // page-level claim then, but "扫描件和电子版对比？可以做" survived in the FAQ, the engine table
  // still listed tessdata as serving scans, and the introduction still said WASM runs OCR.
  // Each of those sends a reader to try something that does not work.
  const files = await walk(DOCS);
  const offenders = [];
  for (const f of files) {
    const body = await readFile(f, "utf8");
    for (const line of body.split("\n")) {
      if (!/OCR|tessdata/i.test(line)) continue;
      // Lines that explicitly say it is not implemented, or that record retiring it, are fine.
      if (/not implemented|没有实现|尚未实现|不成立|retired|removed|已删除|no OCR|未被调用|not called/i.test(line)) continue;
      if (/^>/.test(line.trim())) continue; // historical notes in a blockquote
      offenders.push(`${rel(f)}: ${line.trim().slice(0, 100)}`);
    }
  }
  assert.deepEqual(offenders, [], `docs still promise OCR:\n  ${offenders.join("\n  ")}`);
});

test("every page carries a build stamp", async () => {
  // Cloudflare Pages caches HTML at the edge and `_headers` does not reach an already-cached
  // object, so only a change to the document itself retires a stale copy. The website has had a
  // stamp since day one; the docs did not, and a deploy could sit behind the old page — which is
  // exactly what happened to this one.
  const dist = path.resolve(HERE, "../dist");
  const pages = ["index.html", "en/index.html", "en/integrate/http-sdk/index.html"];
  for (const rel of pages) {
    const html = await readFile(path.join(dist, rel), "utf8").catch(() => "");
    assert.match(html, /diffs-build" content="\d{4}-\d{2}-\d{2}T/, `${rel} has no build stamp`);
  }
});

test("no path inherits a contradictory cache-control", async () => {
  // Cloudflare Pages merges every matching rule. A `/*` rule carrying cache-control is appended to
  // each specific one, which produced `max-age=0, …, max-age=31536000, immutable` on hashed
  // assets — two directives that disagree, with nothing requiring a cache to pick ours. The
  // website hit this first; the docs had the same `/*` shape waiting for it.
  const body = await readFile(path.resolve(HERE, "../public/_headers"), "utf8");
  const blocks = body.split(/\n(?=[^\s#])/).map((b) => b.split("\n")[0].trim());
  assert.ok(blocks.includes("/*"), "no /* rule");
  // the `/*` block runs from its header line to the next header line
  const lines = body.split("\n");
  const start = lines.findIndex((l) => l.trim() === "/*");
  assert.ok(start >= 0, "no /* block found");
  const rootBody = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const l = lines[i];
    if (l.trim() && !/^\s/.test(l)) break; // next top-level header
    rootBody.push(l);
  }
  assert.doesNotMatch(rootBody.join("\n"), /cache-control/, "/* must not set cache-control — it is merged");
  // hashed assets must actually be immutable somewhere
  assert.match(body, /\/_astro\/\*[\s\S]*?immutable/, "hashed assets are not cached as immutable");
});

test("a phone can still navigate between pages", async () => {
  // The sidebar is hidden below 820px, and nothing replaced it: a reader on a phone had no way to
  // move from one page to another except search and the header links.
  const dist = path.resolve(HERE, "../dist");
  const html = await readFile(path.join(dist, "en/reference/portable/index.html"), "utf8");
  assert.match(html, /<details class="docs-side-mobile">/, "no mobile menu");
  const css = await readFile(path.resolve(HERE, "../src/styles/global.css"), "utf8");
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*?\.docs-side-mobile\s*\{\s*display:\s*block/, "the menu is never shown");
  // every page in the collection should be reachable from it
  const links = [...html.matchAll(/<details class="docs-side-mobile">[\s\S]*?<\/details>/g)][0]?.[0] ?? "";
  assert.ok((links.match(/<a /g) || []).length >= 20, `only ${(links.match(/<a /g) || []).length} links`);
});

test("the PDF engine size in the docs matches the files on disk", async () => {
  // The docs said pdf.js was "~1.4 MB" while the site's own load plan said 〜1.8 MB, and the files
  // are 0.4 + 1.4 MB. Understating a download is still a wrong number.
  const dir = path.resolve(HERE, "../../website/public/engine/pdfjs");
  const files = await readdir(dir);
  let bytes = 0;
  for (const f of files) {
    const st = await import("node:fs/promises").then((m) => m.stat(path.join(dir, f)));
    if (st.isFile()) bytes += st.size;
  }
  const mb = bytes / 1024 / 1024;
  const zh = await readFile(path.resolve(HERE, "../src/content/docs/reference/engines.mdx"), "utf8");
  const en = await readFile(path.resolve(HERE, "../src/content/docs/en/reference/engines.mdx"), "utf8");
  const claimed = (s) => [...s.matchAll(/~?\s*([0-9](?:\.[0-9])?)\s*MB/g)].map((m) => Number(m[1]));
  for (const [label, body] of [["zh", zh], ["en", en]]) {
    const nums = claimed(body);
    assert.ok(nums.some((n) => Math.abs(n - mb) <= 0.25), `${label} claims ${nums.join("/")} MB, files are ${mb.toFixed(2)} MB`);
  }
});

test("the search index holds each page's whole text", async () => {
  // The index was cut at 4 000 characters per page. Three pages were already at the cap, so the
  // second half of them — including their closing sections — could not be found by search at all.
  const index = JSON.parse(await readFile(path.resolve(HERE, "../dist/search-index.json"), "utf8"));
  // Long pages are fine; a page cut *while there is more to cut* is not. Compare each indexed
  // body against the page's own sections: if the last heading is not reachable from the text, the
  // index stopped early.
  const truncated = [];
  for (const p of index.pages) {
    const last = p.headings?.[p.headings.length - 1];
    if (!last) continue;
    // headings are stripped from `text`, so look for a distinctive word from the last one
    const word = last.split(/\s+/).filter((w) => w.length > 5).pop();
    if (word && !(p.text ?? "").includes(word)) truncated.push(`${p.url} (last section "${last}" is not in the text)`);
  }
  assert.deepEqual(truncated, [], `these pages are truncated in the index:\n  ${truncated.join("\n  ")}`);
  const bytes = JSON.stringify(index).length;
  assert.ok(bytes < 400 * 1024, `index grew to ${Math.round(bytes / 1024)} KB`);
});

test("no source comment leaks into the served text", async () => {
  // The agent page tells the reader to "hand this whole page to your agent". What the agent
  // received started with two HTML comments — `<!-- A per-build stamp…` — from the layout and the
  // sidebar, because `<!-- -->` survives Astro's output and `{/* */}` does not.
  const dist = path.resolve(HERE, "../dist");
  const pages = ["integrate/agents/index.html", "en/integrate/agents/index.html", "index.html"];
  for (const rel of pages) {
    const html = await readFile(path.join(dist, rel), "utf8").catch(() => "");
    if (!html) continue;
    const leaked = [...html.matchAll(/<!--([\s\S]*?)-->/g)]
      .map((m) => m[1].trim())
      .filter((c) => c && !/^\s*\[/.test(c) && c.length > 40);
    assert.deepEqual(leaked, [], `${rel} serves source comments to readers`);
  }
});

test("the plugin install command is one that can work today", async () => {
  // The docs said `dsh plugin add @diffs/dsh-plugin`. That package is not on npm, so the command
  // 404s — a reader's first step. Round 30 fixed this on the website's configure page and the
  // docs kept the broken form.
  const zh = await readFile(path.resolve(HERE, "../src/content/docs/integrate/deepseek-harness.mdx"), "utf8");
  const en = await readFile(path.resolve(HERE, "../src/content/docs/en/integrate/deepseek-harness.mdx"), "utf8");
  for (const [label, body] of [["zh", zh], ["en", en]]) {
    // The warning text may mention the npm form; what must not appear is a code block running it.
    const codeBlocks = [...body.matchAll(/```bash([\s\S]*?)```/g)].map((m) => m[1]).join("\n");
    assert.doesNotMatch(codeBlocks, /dsh plugin add @diffs\/dsh-plugin/, `${label} tells readers to install from npm`);
    assert.match(body, /dsh plugin add \.\/apps\/dsh-plugin/, `${label} has no local install command`);
    assert.match(body, /pnpm build:plugin/, `${label} does not say to build first`);
  }
});
