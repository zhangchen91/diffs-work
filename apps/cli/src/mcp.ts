/**
 * `diffs mcp` — the same diff tool, spoken as MCP over stdio.
 *
 * Any MCP client (Claude Desktop, an IDE agent, DeepSeek Harness) can call `diff_compare` and get
 * back the canonical result: the same object the CLI prints, the local server returns and the
 * website renders. Nothing here is a second implementation — it is a transport.
 *
 * Transport: newline-delimited JSON-RPC 2.0 on stdin/stdout, which is what the MCP stdio
 * transport is. No dependency is pulled in for that, and stderr stays free for diagnostics.
 */
import { compareFiles , DIFF_TOOL } from "@diffs/diff-tool";
import { DIFFS_VERSION } from "@diffs/shared";

/** The tools this server offers. Kept to one: a diff is one verb. */
// One definition, shared with the DSH plugin and any other agent surface.
const TOOLS = [DIFF_TOOL] as const;

interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

function send(msg: unknown): void {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function reply(id: RpcRequest["id"], result: unknown): void {
  send({ jsonrpc: "2.0", id: id ?? null, result });
}

function fail(id: RpcRequest["id"], code: number, message: string): void {
  send({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

/**
 * The tool's answer. A failed comparison is reported as `isError` with the reason, never as an
 * empty diff: "no differences" and "could not read the file" must never look alike.
 */
async function callTool(name: string, args: Record<string, unknown>) {
  if (name !== "diff_compare") {
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
  try {
    const result = await compareFiles({
      old: typeof args.old === "string" ? args.old : undefined,
      new: typeof args.new === "string" ? args.new : undefined,
      revision: typeof args.revision === "string" ? args.revision : undefined,
      cwd: typeof args.cwd === "string" ? args.cwd : undefined,
      context: typeof args.context === "number" ? args.context : undefined,
      maxHunks: typeof args.maxHunks === "number" ? args.maxHunks : undefined,
      format: args.format === "unified" ? "unified" : "json",
    });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `diff_compare failed: ${message}` }],
      isError: true,
    };
  }
}

async function handle(req: RpcRequest): Promise<void> {
  switch (req.method) {
    case "initialize":
      reply(req.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "diffs.work", version: DIFFS_VERSION },
      });
      return;
    case "tools/list":
      reply(req.id, { tools: TOOLS });
      return;
    case "tools/call": {
      const p = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      if (!p.name) {
        fail(req.id, -32602, "tools/call needs a `name`");
        return;
      }
      reply(req.id, await callTool(p.name, p.arguments ?? {}));
      return;
    }
    case "ping":
      reply(req.id, {});
      return;
    // Notifications carry no id and need no answer.
    case "notifications/initialized":
    case "initialized":
      return;
    default:
      if (req.id !== undefined && req.id !== null) {
        fail(req.id, -32601, `Method not found: ${req.method}`);
      }
  }
}

/** Read newline-delimited JSON-RPC from stdin until the stream ends. */
export async function runMcp(): Promise<void> {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let req: RpcRequest;
      try {
        req = JSON.parse(line) as RpcRequest;
      } catch {
        fail(null, -32700, "Parse error");
        continue;
      }
      void handle(req).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        fail(req.id, -32603, message);
      });
    }
  });
  await new Promise<void>((resolve) => process.stdin.on("end", resolve));
}