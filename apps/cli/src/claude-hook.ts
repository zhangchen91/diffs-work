/**
 * Claude Code's PostToolUse hook: show what an edit changed, in the CLI.
 *
 * Claude Code has no slot a plugin can draw a card into — it is a terminal — so "the same rendering
 * on every surface" cannot mean a React view here. What it can mean is the same *description*: the
 * hook reads the tool call, asks the same `compareFiles`, and prints the OpenUI card's text. The
 * person sees what changed, printed where they are, without asking the agent to run a diff.
 *
 * Reads the hook payload on stdin, writes to stdout. A failure must never block the tool, so
 * anything unexpected exits 0 silently.
 */
import { copyFileSync, readFileSync, existsSync, rmSync } from "node:fs";
export { runSnapshot } from "./claude-snapshot.js";
import { tmpdir } from "node:os";
import path from "node:path";
import { compareFiles } from "@diffs/diff-tool";

interface HookPayload {
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
}

/** Tools that change a file, and where each keeps the path and the text it wrote. */
const EDIT_TOOLS: Record<string, { pathKeys: string[]; oldKeys?: string[]; newKeys?: string[] }> = {
  Edit: { pathKeys: ["file_path", "path"], oldKeys: ["old_string"], newKeys: ["new_string"] },
  MultiEdit: { pathKeys: ["file_path", "path"] },
  Write: { pathKeys: ["file_path", "path"], newKeys: ["content"] },
  NotebookEdit: { pathKeys: ["notebook_path", "path"] },
};

function firstString(args: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = args[k];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

/** The snapshot this hook took before the edit, if one exists. */
function snapshotPath(cwd: string, file: string): string {
  return path.join(tmpdir(), "diffs-claude", `${Buffer.from(path.resolve(cwd, file)).toString("base64url")}.txt`);
}

async function post(): Promise<void> {
  let payload: HookPayload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return;
  }
  const tool = payload.tool_name ?? "";
  const shape = EDIT_TOOLS[tool];
  if (!shape) return;
  const args = payload.tool_input ?? {};
  const cwd = payload.cwd || process.cwd();
  const file = firstString(args, shape.pathKeys);
  if (!file) return;
  const abs = path.resolve(cwd, file);
  if (!existsSync(abs)) return;

  const snap = snapshotPath(cwd, file);
  if (!existsSync(snap)) {
    // No before-image: the pair is unknown, and printing a diff against nothing would be a lie.
    return;
  }
  const oldPath = snap;
  const newPath = `${snap}.after`;
  try {
    copyFileSync(abs, newPath);
    return compareFiles({ old: oldPath, new: newPath }).then((r) => {
      // Claude shows hook stdout to the person, not to the model: this is the row they read after
      // an edit, which is what the CLI already prints for `diffs diff`.
      process.stdout.write(`${r.summary}\n`);
      for (const h of r.hunks.slice(0, 3)) {
        for (const l of h.lines.slice(0, 8)) {
          const sign = l.kind === "insert" ? "+" : l.kind === "delete" ? "-" : " ";
          process.stdout.write(`${sign} ${l.text}\n`);
        }
      }
      try {
        rmSync(newPath, { force: true });
      } catch {
        /* the temp copy is disposable */
      }
    });
  } catch {
    /* never block the tool */
  }
}

export async function runPost(): Promise<void> {
  await post();
  // The process exits as soon as the event loop drains, so the comparison has to be awaited: a
  // floating promise printed nothing at all.


}

