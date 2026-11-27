/**
 * The commands the docs tell a reader to run must run.
 *
 * Only the local, side-effect-free ones are executed here: building the CLI, diffing two files,
 * and reading the JSON with the very `jq` expressions the pages print. Anything that touches the
 * network, installs something, or writes to a home directory is checked by inspection instead —
 * the point of this file is the commands people actually copy first.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const DOCS = path.join(ROOT, "apps/docs/src/content/docs");
const BIN = path.join(ROOT, "apps/cli/lib/bin.js");

function sh(args, input) {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, args, { cwd: ROOT, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ code: err ? (err.code ?? 1) : 0, stdout, stderr }),
    );
    if (input) child.stdin?.end(input);
  });
}

async function mdxFiles(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await mdxFiles(p)));
    else if (e.name.endsWith(".mdx")) out.push(p);
  }
  return out;
}

test("every jq expression the docs print actually works on our output", async () => {
  const files = await mdxFiles(DOCS);
  const exprs = new Set();
  for (const f of files) {
    const body = await readFile(f, "utf8");
    for (const m of body.matchAll(/--json\s*\|\s*jq\s+'([^']+)'/g)) exprs.add(m[1]);
  }
  assert.ok(exprs.size > 0, "no jq examples found — did the docs change shape?");
  const json = (await sh([BIN, "diff", "examples/code/pricebook-v1.ts", "examples/code/pricebook-v2.ts", "--json"])).stdout;
  for (const e of exprs) {
    const r = await sh(["-e", `let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const j=JSON.parse(s);
      // a tiny jq stand-in: only the shapes the docs use
      const path = ${JSON.stringify(e)}.replace(/^\\./, "").split(".");
      let v = j; for (const k of path) v = v?.[k];
      process.stdout.write(v === undefined ? "NULL" : JSON.stringify(v));
    }catch(err){process.stdout.write("ERR")}})`, ], json);
    assert.notEqual(r.stdout.trim(), "NULL", `jq '${e}' selects a field that does not exist`);
    assert.notEqual(r.stdout.trim(), "ERR", `jq '${e}' could not read the output`);
  }
});

test("the docs never tell a reader to run `diffs` as if it were installed", async () => {
  // The CLI is not on npm, so `diffs` is not on PATH. Any line that invokes it as a command has
  // to be the built entry point instead.
  const files = await mdxFiles(DOCS);
  const offenders = [];
  for (const f of files) {
    const body = await readFile(f, "utf8");
    for (const line of body.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("diffs ")) continue;
      // A bare `diffs <cmd>` is fine when the same page explains the substitution, or when the
      // page is the reference for the CLI itself.
      const explained = /not on npm yet|还没发布到 npm|node apps\/cli\/lib\/bin\.js/.test(body);
      const isCliPage = f.endsWith("cli.mdx") || f.endsWith("agents.mdx");
      if (!explained && !isCliPage) offenders.push(`${path.relative(ROOT, f)}: ${t}`);
    }
  }
  assert.deepEqual(offenders, [], `these pages invoke an unpublished binary:\n  ${offenders.join("\n  ")}`);
});

test("the SDK example in the docs shows what the code actually prints", async () => {
  // The docs showed `summarizeThin(r) // "+3 −1 · 2 changes"`. The function prints
  // "1 处差异 · +11/-7 行 · symbols +2/-2" — a different format, in Chinese, and with symbols.
  // A reader comparing the two concludes the example is out of date or the code is broken.
  const { readFile } = await import("node:fs/promises");
  const docs = [
    path.join(ROOT, "apps/docs/src/content/docs/integrate/http-sdk.mdx"),
    path.join(ROOT, "apps/docs/src/content/docs/en/integrate/http-sdk.mdx"),
  ];
  const printed = (await sh([BIN, "diff", "examples/code/pricebook-v1.ts", "examples/code/pricebook-v2.ts"])).stdout
    .split("\n")[1]
    .trim();
  assert.ok(printed.length > 5, `no summary line: ${printed}`);
  for (const f of docs) {
    const body = await readFile(f, "utf8");
    const m = body.match(/summarizeThin\(r\)\);\s*\/\/ "([^"]+)"/);
    assert.ok(m, `${path.basename(f)} has no summarise example`);
    assert.equal(m[1], printed, `${path.basename(f)} shows a summary the code does not print`);
  }
});
