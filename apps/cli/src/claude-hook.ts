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
  // The suffix is part of the identity: the post hook compares this snapshot against the file, and
  // `compareFiles` chooses a document engine by extension. A `.txt` snapshot of a `.docx` made every
  // document edit print zip bytes instead of its paragraphs.
  const suffix = path.extname(file) || ".bin";
  return path.join(tmpdir(), "diffs-claude", `${Buffer.from(path.resolve(cwd, file)).toString("base64url")}${suffix}`);
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
  // The temp copies have to keep the file's extension: `compareFiles` picks the engine from it, so a
  // `.docx` copied to `foo.after` was compared as text and the card printed zip entries.
  const suffix = path.extname(abs);
  const newPath = `${snap}.after${suffix}`;
  try {
    copyFileSync(abs, newPath);
    return compareFiles({ old: oldPath, new: newPath }).then((r) => {
      // Claude shows hook stdout to the person, not to the model: this is the row they read after
      // an edit, which is what the CLI already prints for `diffs diff`.
      process.stdout.write(`${r.summary}\n`);
      // A document's rows are its parts and paragraphs, not bytes. Printing them with a `+`/`-`
      // gutter drew raw zip entries into the terminal (measured: a `.docx` edit printed
      // "[Content_Types].xml" and PK headers), which is worse than saying nothing.
      const isDocument = r.family === "docx" || r.family === "xlsx" || r.family === "pptx" || r.family === "pdf";
      for (const h of r.hunks.slice(0, 3)) {
        if (isDocument) process.stdout.write(`${h.header}\n`);
        for (const l of h.lines.slice(0, isDocument ? 10 : 8)) {
          const sign = isDocument ? " " : l.kind === "insert" ? "+" : l.kind === "delete" ? "-" : " ";
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

