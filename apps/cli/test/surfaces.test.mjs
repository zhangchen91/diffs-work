/**
 * The four surfaces promise the same answer. This checks the numbers, not just the keys.
 *
 * The site, the CLI, the local HTTP endpoint and the MCP server all end up in `compareFiles`, but
 * they reach it by different paths (a file read, a POST body, a JSON-RPC tool call) and it is the
 * numbers a reader would notice disagreeing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const BIN = path.join(ROOT, "apps/cli/lib/bin.js");
const PAIR = { old: "examples/code/pricebook-v1.ts", new: "examples/code/pricebook-v2.ts" };

const shape = (j) => ({
  added: j.added,
  removed: j.removed,
  countsAdded: j.counts?.added,
  countsRemoved: j.counts?.removed,
  countsChanged: j.counts?.changed,
  hunks: j.hunks?.length,
  schema: j.schema,
});

test("CLI and the MCP server report the same numbers", async () => {
  const cli = await new Promise((resolve, reject) => {
    execFile(process.execPath, [BIN, "diff", PAIR.old, PAIR.new, "--json"], { cwd: ROOT, maxBuffer: 1 << 24 }, (e, out) =>
      e ? reject(e) : resolve(JSON.parse(out)),
    );
  });

  const child = spawn(process.execPath, [BIN, "mcp"], { cwd: ROOT, stdio: ["pipe", "pipe", "inherit"] });
  let buf = "";
  const replies = [];
  child.stdout.on("data", (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) replies.push(JSON.parse(line));
    }
  });
  const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
  await new Promise((r) => setTimeout(r, 300));
  send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "diff_compare", arguments: PAIR } });
  await new Promise((r) => setTimeout(r, 1500));
  child.kill();

  const reply = replies.find((r) => r.id === 2);
  assert.ok(reply?.result?.content?.[0]?.text, "no tool result");
  const mcp = JSON.parse(reply.result.content[0].text);
  assert.deepEqual(shape(mcp), shape(cli), "the MCP server and the CLI disagree");
  assert.equal(cli.schema, "diffs.work/portable@1");
  assert.ok(cli.added > 0 && cli.removed > 0);
});

test("the SDK import in the docs actually imports", async () => {
  // The docs' first SDK example is `import { compareFiles } from "@diffs/diff-tool"` inside the
  // workspace. Every relative import in the package was extensionless, which bundlers accept and
  // Node's ESM resolver does not — so importing the package from any Node script failed before a
  // single comparison could run. The page says "reference it from inside the pnpm workspace"; this
  // is that, executed.
  const { execFile } = await import("node:child_process");
  const script = `
    import { compareFiles, summarizeThin } from "@diffs/diff-tool";
    const r = await compareFiles({ old: "../../examples/code/pricebook-v1.ts", new: "../../examples/code/pricebook-v2.ts" });
    process.stdout.write(JSON.stringify({ schema: r.schema, added: r.added, summary: summarizeThin(r) }));
  `;
  const out = await new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "-e", script],
      { cwd: path.join(ROOT, "apps/dsh-plugin"), maxBuffer: 1 << 24 },
      (e, stdout) => (e ? reject(e) : resolve(stdout)),
    );
    void child;
  });
  const j = JSON.parse(out);
  assert.equal(j.schema, "diffs.work/portable@1");
  assert.ok(j.added > 0, JSON.stringify(j));
  assert.match(j.summary, /处差异/);
});

test("the same pair is byte-identical over the CLI and HTTP", async () => {
  // The HTTP endpoint appended its own `summary` to every result, so an xlsx came back with a
  // summary over HTTP and without one on the command line — the readme's central promise
  // ("the same answer everywhere") broken by one extra spread.
  const { execFile: exec } = await import("node:child_process");
  const cliJson = (args) =>
    new Promise((resolve, reject) => {
      exec(process.execPath, [BIN, ...args], { cwd: ROOT, maxBuffer: 1 << 24 }, (e, out) => (e ? reject(e) : resolve(JSON.parse(out))));
    });
  const { startLocalServer } = await import("@diffs/diff-tool/server");
  const server = await startLocalServer({ port: 0, open: false });
  try {
    const pairs = [
      ["examples/code/pricebook-v1.ts", "examples/code/pricebook-v2.ts"],
      ["test-cases/all-ops/excel.before.xlsx", "test-cases/all-ops/excel.after.xlsx"],
      ["test-cases/all-ops/word.before.docx", "test-cases/all-ops/word.after.docx"],
    ];
    const norm = (o) => JSON.stringify(Object.keys(o).sort().reduce((m, k) => ((m[k] = o[k]), m), {}));
    for (const [a, b] of pairs) {
      const cli = await cliJson(["diff", a, b, "--json"]);
      const res = await fetch(`${server.url}/api/diff`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ old: a, new: b }),
      });
      const http = await res.json();
      assert.equal(norm(http), norm(cli), `${a} differs between CLI and HTTP`);
      assert.ok(cli.summary?.length > 0, `${a} has no summary`);
    }
  } finally {
    await server.close?.();
  }
});

test("the local API says 400 for a bad request and 404 for a wrong path", async () => {
  // Everything used to be 500 — a typo in the request looked like a server fault — and an unknown
  // /api/ path returned the HTML shell with status 200, which a JSON client then tried to parse.
  const { startLocalServer } = await import("@diffs/diff-tool/server");
  const server = await startLocalServer({ port: 0, open: false });
  try {
    const post = (body) =>
      fetch(`${server.url}/api/diff`, { method: "POST", headers: { "content-type": "application/json" }, body });

    assert.equal((await post(JSON.stringify({ old: "/nope.ts", new: "/nope2.ts" }))).status, 400);
    assert.equal((await post("{not json")).status, 400);
    assert.equal((await post("{}")).status, 400);
    assert.equal((await post(JSON.stringify(PAIR))).status, 200);

    const wrong = await fetch(`${server.url}/api/nope`);
    assert.equal(wrong.status, 404);
    assert.match(wrong.headers.get("content-type") ?? "", /json/, "a wrong API path must answer JSON");
  } finally {
    await server.close?.();
  }
});
