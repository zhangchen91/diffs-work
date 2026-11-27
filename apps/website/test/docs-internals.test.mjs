/**
 * The internal notes under `docs/` describe the architecture, so a retired engine there is worse
 * than a stale README: it is what a contributor reads before touching the code.
 *
 * `docxodus` (a ~30 MB .NET renderer, dropped in round 2) was still listed as the Word engine in
 * six files, `office-x2t` was listed as distributed when nothing ships it, and the build tree
 * named an `engine/docxodus/` directory that is not in the output.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DOCS = path.join(ROOT, "docs");

/** Engines that no longer exist anywhere in the build. */
const RETIRED = ["docxodus"];

test("the internal notes do not present a retired engine as current", async () => {
  const offenders = [];
  for (const f of readdirSync(DOCS).filter((n) => n.endsWith(".md"))) {
    const body = await readFile(path.join(DOCS, f), "utf8");
    for (const line of body.split("\n")) {
      if (!RETIRED.some((e) => line.includes(e))) continue;
      // a line explaining that it was removed is fine
      if (/已退役|已经退役|曾经|不再|retired|removed|已删除/.test(line)) continue;
      offenders.push(`${f}: ${line.trim().slice(0, 90)}`);
    }
  }
  assert.deepEqual(offenders, [], `internal docs still describe retired engines:\n  ${offenders.join("\n  ")}`);
});

test("every engine directory the notes name is in the build output", async () => {
  const out = path.join(ROOT, "apps/website/out/engine");
  const built = existsSync(out) ? new Set(readdirSync(out)) : new Set();
  if (!built.size) return; // no build present; nothing to compare against
  const notes = await readFile(path.join(DOCS, "deploy.md"), "utf8");
  const m = notes.match(/engine\/\{([^}]+)\}/);
  assert.ok(m, "deploy.md no longer documents the engine tree");
  for (const name of m[1].split(",").map((s) => s.trim())) {
    assert.ok(built.has(name), `deploy.md lists engine/${name}, not in the build (${[...built].join(", ")})`);
  }
});
