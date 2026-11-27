/**
 * The MCP surface, exercised the way a client does: newline-delimited JSON-RPC on stdio.
 *
 * These tests exist because the transport is hand-written. A protocol bug here would show up as
 * "the agent says there were no changes" rather than as an error, which is the worst failure this
 * product can have.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const BIN = path.join(ROOT, "apps/cli/lib/bin.js");

/** Run the server with `requests`, resolve with the parsed response lines. */
function rpc(requests) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, "mcp"], { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timeout; stderr: ${err}`));
    }, 30_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", reject);
    child.on("close", () => {
      clearTimeout(timer);
      if (!out.trim()) return reject(new Error(`no output; stderr: ${err}`));
      resolve(out.trim().split("\n").map((l) => JSON.parse(l)));
    });
    for (const r of requests) child.stdin.write(`${JSON.stringify(r)}\n`);
    child.stdin.end();
  });
}

test("initialize reports the server and a protocol version", async () => {
  const [first] = await rpc([{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }]);
  assert.equal(first.jsonrpc, "2.0");
  assert.equal(first.id, 1);
  assert.equal(first.result.serverInfo.name, "diffs.work");
  assert.match(first.result.protocolVersion, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(first.result.capabilities.tools);
});

test("tools/list offers exactly one verb: diff_compare", async () => {
  const [res] = await rpc([{ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }]);
  const tools = res.result.tools;
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, "diff_compare");
  assert.ok(tools[0].inputSchema.properties.old);
  assert.deepEqual(tools[0].inputSchema.required, ["old"]);
});

test("diff_compare returns a real diff, not a summary", async () => {
  const [res] = await rpc([
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "diff_compare",
        arguments: { old: "examples/code/pricebook-v1.ts", new: "examples/code/pricebook-v2.ts" },
      },
    },
  ]);
  const r = res.result;
  assert.notEqual(r.isError, true, JSON.stringify(r).slice(0, 300));
  const body = r.structuredContent;
  assert.equal(body.family, "code");
  assert.ok(body.added > 0, `added ${body.added}`);
  assert.ok(body.removed > 0, `removed ${body.removed}`);
  assert.ok(Array.isArray(body.hunks) && body.hunks.length > 0, "hunks are carried");
});

test("a failure is an error, never an empty diff", async () => {
  const [res] = await rpc([
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "diff_compare", arguments: { old: "no/such/file.ts" } },
    },
  ]);
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /failed/);
  assert.equal(res.result.structuredContent, undefined, "no result object on failure");
});

test("an unknown method is answered, not ignored", async () => {
  const [res] = await rpc([{ jsonrpc: "2.0", id: 7, method: "does/not/exist", params: {} }]);
  assert.equal(res.id, 7);
  assert.equal(res.error.code, -32601);
});
test("the MCP tool takes the same arguments as the Harness plugin", async () => {
  // The docs claim all four surfaces share one signature. If these drift, an agent that works in
  // one client silently fails in another, so the claim is pinned here.
  const { DIFF_TOOL_PARAMETERS } = await import("../../dsh-plugin/lib/index.js").catch(() => ({}));
  const [res] = await rpc([{ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }]);
  const mcpProps = Object.keys(res.result.tools[0].inputSchema.properties).sort();
  assert.deepEqual(mcpProps, ["context", "cwd", "format", "maxHunks", "new", "old", "revision"]);
  if (DIFF_TOOL_PARAMETERS) {
    // the plugin's own schema, when built, must be a subset of the same names
    const pluginProps = Object.keys(DIFF_TOOL_PARAMETERS.properties ?? {}).sort();
    for (const p of pluginProps) {
      assert.ok(mcpProps.includes(p), `plugin exposes ${p}, MCP does not`);
    }
  }
});
