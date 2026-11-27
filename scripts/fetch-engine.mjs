/**
 * Download the third-party engine bundles this repo does not vendor.
 *
 * `apps/website/public/engine/` is build input, not source (see .gitignore): the
 * folder holds ~50 MB of binaries and is produced by one of two paths —
 *
 *   pnpm sync:engine     copy from a local `vendored/engine/` checkout, or
 *   pnpm fetch:engine    download the pinned release archive, then verify sha256
 *
 * Pinned versions and checksums live in `engine.lock.json`. Without a network the
 * site still builds: the diff card falls back to the TypeScript engines and the
 * compare page reports the engine as unavailable instead of pretending.
 */
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT = path.join(ROOT, "apps/website/public/engine");

const lock = JSON.parse(await readFile(path.join(ROOT, "engine.lock.json"), "utf8"));

async function sha256(file) {
  const hash = createHash("sha256");
  hash.update(await readFile(file));
  return hash.digest("hex");
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  await mkdir(path.dirname(dest), { recursive: true });
  await pipeline(res.body, createWriteStream(dest));
}

async function main() {
  for (const engine of lock.engines) {
    const dest = path.join(OUT, engine.id);
    try {
      await stat(dest);
      if (!process.argv.includes("--force")) {
        console.log(`[fetch-engine] ${engine.id}: already present, skipping (use --force to refetch)`);
        continue;
      }
      await rm(dest, { recursive: true, force: true });
    } catch {
      /* not present yet */
    }
    const archive = path.join(ROOT, ".engine-cache", `${engine.id}.zip`);
    console.log(`[fetch-engine] ${engine.id} ${engine.version}`);
    await download(engine.url, archive);
    const got = await sha256(archive);
    if (engine.sha256 && got !== engine.sha256) {
      throw new Error(`[fetch-engine] ${engine.id}: sha256 mismatch\n  expected ${engine.sha256}\n  got      ${got}`);
    }
    await mkdir(dest, { recursive: true });
    const { execFile } = await import("node:child_process");
    await new Promise((resolve, reject) =>
      execFile("unzip", ["-q", "-o", archive, "-d", dest], (err) => (err ? reject(err) : resolve())),
    );
    console.log(`[fetch-engine] ${engine.id}: ready at ${path.relative(ROOT, dest)}`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
