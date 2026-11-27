/**
 * A real MCP client, end to end: initialize, tools/list, tools/call.
 *
 * The docs advertise the MCP server, and the only way to know a client can actually use it is to
 * be one. This speaks the protocol over stdio exactly as Claude or Cursor would and fails if any
 * step does not come back.
 *
 *   node scripts/verify-mcp.mjs
 */
import { spawn } from "node:child_process";

const proc = spawn(process.execPath, ["apps/cli/lib/bin.js", "mcp"], { stdio: ["pipe", "pipe", "pipe"] });
let buf = "";
const out = [];
proc.stdout.on("data", (d) => {
  buf += d;
  const lines = buf.split("\n");
  buf = lines.pop() ?? "";
  for (const l of lines) if (l.trim()) out.push(JSON.parse(l));
});

const send = (msg) => proc.stdin.write(JSON.stringify(msg) + "\n");
const waitFor = async (id, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const hit = out.find((m) => m.id === id);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
};

send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "verify", version: "1" } } });
const init = await waitFor(1);
const fail = (why) => {
  console.error("[mcp] " + why);
  process.exit(1);
};
console.log("INIT " + JSON.stringify({ ok: !!init?.result, server: init?.result?.serverInfo, proto: init?.result?.protocolVersion }));

send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
const list = await waitFor(2);
const tools = (list?.result?.tools ?? []).map((t) => t.name);
console.log("TOOLS " + JSON.stringify(tools));

send({
  jsonrpc: "2.0", id: 3, method: "tools/call",
  params: { name: "diff_compare", arguments: { old: "test-cases/all-ops/code/rust.before.rs", new: "test-cases/all-ops/code/rust.after.rs" } },
});
const call = await waitFor(3, 30000);
const text = call?.result?.content?.[0]?.text ?? "";
console.log("CALL " + JSON.stringify({ ok: !!call?.result, isError: !!call?.result?.isError, len: text.length, hasSchema: /portable@1/.test(text), preview: text.slice(0, 160) }));

if (!init?.result) fail("initialize did not answer");
if (!tools.includes("diff_compare")) fail("diff_compare is not exposed: " + tools.join(", "));
if (!call?.result || call.result.isError) fail("tools/call failed: " + JSON.stringify(call?.result ?? call));
if (!/portable@1/.test(text)) fail("the tool result is not a portable@1 document");

proc.stdin.end();
proc.kill();
console.log("\n[mcp] initialize, tools/list and tools/call all answered");
