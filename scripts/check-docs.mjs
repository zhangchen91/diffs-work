/**
 * Every docs page renders, in both languages, with no dead internal link.
 *
 * The docs site is 52 pages of Astro over 50 markdown files. It has been deployed several times
 * without anyone opening more than the page they were editing, so a page that fails to build its
 * body, or a link to a route that was renamed, would only be found by a reader.
 *
 *   node scripts/check-docs.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIST = path.join(ROOT, "apps/docs/dist");

/** Every built page, as a URL path. */
function pages(dir, base = "") {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...pages(full, `${base}/${name}`));
    } else if (name === "index.html") {
      out.push(base === "" ? "/" : `${base}/`);
    }
  }
  return out;
}

const all = new Set(pages(DIST));
const failures = [];

for (const page of all) {
  const file = path.join(DIST, page === "/" ? "index.html" : `${page}index.html`);
  const html = readFileSync(file, "utf8");
  const text = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");

  if (text.trim().length < 400) failures.push(`${page}: the page has almost no text (${text.trim().length} chars)`);
  // An unresolved message key is shipped as its own name.
  // A message key looks like ; a domain like  does not, so
  // require the last segment to contain no further dots and at least two dots before it.
  // A message key looks like `formats.code.blurb`. A domain (`docs.diffs.work`) has the same
  // shape, so a TLD is excluded explicitly rather than left to the reader to explain.
  const leak = /(?:^|\s)(?:docs|nav|formats|compare)\.[a-z][\w]*\.(?!work\b|dev\b|com\b|io\b|org\b)[a-z][\w]*/.exec(text);
  if (leak) failures.push(`${page}: an untranslated key is on the page (${leak[0].trim()})`);

  for (const m of html.matchAll(/href="(\/[^"#?]*)/g)) {
    const target = m[1];
    if (/\.(png|svg|ico|css|js|json|xml|txt|webmanifest)$/.test(target)) continue;
    const normal = target.endsWith("/") ? target : `${target}/`;
    if (!all.has(normal) && !target.startsWith("/_astro")) {
      failures.push(`${page}: dead link → ${target}`);
    }
  }
}

console.log(`[docs] pages: ${all.size}`);
if (failures.length) {
  console.error(`\nFAILURES (${failures.length}):\n` + failures.slice(0, 40).map((f) => "  - " + f).join("\n"));
  process.exit(1);
}
console.log("[docs] every page renders with text, and every internal link resolves");
