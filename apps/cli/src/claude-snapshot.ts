/**
 * Claude Code's PreToolUse hook: remember the file before an edit changes it.
 *
 * The companion to `claude-hook.ts`. A hook cannot see what a file used to contain once it has been
 * written, so the before-image has to be taken first. Keyed by absolute path in a temp directory so
 * the post hook can find it, and written only for tools that change a file.
 */
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The hook payload, read once from stdin.
 *
 * `readFileSync(0)` returns nothing the second time it runs in one process, and this command is
 * dispatched from `main.ts` where other paths may already have looked at stdin. Reading through a
 * single helper keeps that from being a silent empty parse.
 */
export function readPayload(): string {
  return readFileSync(0, "utf8");
}
import { tmpdir } from "node:os";
import path from "node:path";

const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
const PATH_KEYS = ["file_path", "path", "notebook_path"];

export function runSnapshot(): void {
  let payload: { cwd?: string; tool_name?: string; tool_input?: Record<string, unknown> };
  try {
    payload = JSON.parse(readPayload());
  } catch {
    return;
  }
  if (!EDIT_TOOLS.has(payload.tool_name ?? "")) return;
  const args = payload.tool_input ?? {};
  const file = PATH_KEYS.map((k) => args[k]).find((v): v is string => typeof v === "string" && Boolean(v));
  if (!file) return;
  const cwd = payload.cwd || process.cwd();
  const abs = path.resolve(cwd, file);
  const dir = path.join(tmpdir(), "diffs-claude");
  try {
    mkdirSync(dir, { recursive: true });
    copyFileSync(abs, path.join(dir, `${Buffer.from(abs).toString("base64url")}.txt`));
  } catch {
    // A new file has nothing to copy; the post hook then has no before-image and stays quiet.
  }
}

