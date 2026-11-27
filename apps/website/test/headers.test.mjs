/**
 * Cache policy for the deployed assets.
 *
 * The kernel is our own code and is rewritten often. It was missing from _headers, so
 * Cloudflare's default (s-maxage=604800) served a week-old kernel after a deploy — the
 * site ran the old, quadratic build while CI and local tests saw the new one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HEADERS = path.join(HERE, "../public/_headers");

/** Parse the small subset of the _headers file format: blocks of `path` + `key: value`. */
function parse(text) {
  const out = new Map();
  let current = null;
  for (const raw of text.split("\n")) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    if (!raw.startsWith(" ") && !raw.startsWith("\t")) {
      current = raw.trim();
      out.set(current, {});
    } else if (current) {
      const at = raw.indexOf(":");
      if (at > 0) out.get(current)[raw.slice(0, at).trim().toLowerCase()] = raw.slice(at + 1).trim();
    }
  }
  return out;
}

const rules = parse(readFileSync(HEADERS, "utf8"));

test("the kernel is revalidated on every load, not cached for a week", () => {
  const rule = rules.get("/engine/rules-core/*");
  assert.ok(rule, "no cache rule for the kernel: Cloudflare would apply its 7-day default");
  const cc = (rule["cache-control"] ?? "").toLowerCase();
  assert.match(cc, /max-age=0|no-cache/, `kernel cache-control is ${cc || "(unset)"}`);
  assert.match(cc, /must-revalidate|no-cache/, cc);
  assert.doesNotMatch(cc, /s-maxage=\d{4,}/, `a long shared cache would serve a stale kernel: ${cc}`);
});

test("third-party engines keep their long cache", () => {
  for (const p of ["/engine/pdfjs/*", "/engine/tessdata/*"]) {
    const rule = rules.get(p);
    assert.ok(rule, `missing rule for ${p}`);
    assert.match(rule["cache-control"] ?? "", /max-age=\d+/, p);
  }
});

test("hashed assets stay immutable", () => {
  const rule = rules.get("/assets/*");
  assert.ok(rule);
  assert.match(rule["cache-control"] ?? "", /immutable/);
});

test("no path inherits a contradictory cache-control", () => {
  // Cloudflare Pages merges every matching rule. A `/*` rule carrying `cache-control` is
  // appended to each specific one, which produced
  //   max-age=0, must-revalidate, no-transform, public, max-age=31536000, immutable
  // on hashed assets: two max-ages in one value, and nothing requires a cache to pick ours.
  const root = rules.get("/*");
  assert.ok(root, "missing /* rule");
  assert.equal(
    root["cache-control"],
    undefined,
    "/* must not set cache-control — it is merged into every other rule",
  );
  // And no two rules may disagree about the same path prefix.
  const specific = [...rules.keys()].filter((k) => k !== "/*");
  for (const k of specific) {
    assert.ok(k.length > 0);
  }
});
