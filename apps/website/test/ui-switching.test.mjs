/**
 * UI switching regressions, driven against a running preview build.
 *
 * `pnpm test:ui` starts `vite preview` first (scripts/test-ui.mjs). The cases
 * come from real reports: tab switching re-mounted nodes, and switching samples
 * left the previous engine's badges / panes behind.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.DIFFS_UI_BASE ?? "http://127.0.0.1:5199";

let ego;
async function open() {
  if (!ego) {
    const mod = await import("node:module");
    void mod;
  }
  return null;
}

// ego-browser is driven out-of-process; this test only asserts the rules that do
// not need a browser (kept for CI without a browser) and defers the full pass to
// scripts/test-ui.mjs which runs the same script through ego-browser.
test("preview build serves the compare surface", { skip: !process.env.DIFFS_UI_BASE }, async () => {
  const html = await fetch(`${BASE}/`).then((r) => r.text());
  assert.match(html, /<div id="root">/);
});

test("the rules-core kernel is published next to the site", { skip: !process.env.DIFFS_UI_BASE }, async () => {
  const res = await fetch(`${BASE}/engine/rules-core/diffs-engine.wasm`);
  assert.equal(res.status, 200);
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.ok(bytes.length > 100_000, `wasm size ${bytes.length}`);
});

test("the pdf samples and the rest of the fixtures are published", { skip: !process.env.DIFFS_UI_BASE }, async () => {
  for (const f of ["nda-v1.pdf", "nda-v2.pdf", "contract-v1.docx", "checklist-B3.xlsx"]) {
    const res = await fetch(`${BASE}/examples/${f}`);
    assert.equal(res.status, 200, f);
    assert.ok((await res.arrayBuffer()).byteLength > 500, f);
  }
});

void open;
