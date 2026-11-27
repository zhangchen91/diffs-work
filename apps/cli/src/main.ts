/**
 * `diffs` CLI — one entry for every local surface.
 *
 *   diffs local [--port 5279] [--no-open]   start the viewer (and inbox) and open it
 *   diffs inbox [--open]                    same server, straight to #/inbox
 *   diffs diff <old> <new> [--unified]      one-shot compare in the terminal
 *   diffs mcp                               the same tool as an MCP server on stdio
 *   diffs paths                             show where diffs.work keeps its data
 *   diffs version
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { compareFiles, summarizeThin } from "@diffs/diff-tool";
import { runMcp } from "./mcp.js";
import { diffsHome, DIFFS_VERSION, LOCAL_DEFAULT_PORT } from "@diffs/shared";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function main(argv: string[]): Promise<void> {
  const [cmd = "local", ...rest] = argv;
  const flags = parseFlags(rest);

  switch (cmd) {
    case "-v":
    case "--version":
    case "version":
      console.log(`diffs ${DIFFS_VERSION}`);
      return;
    case "paths":
      console.log(diffsHome());
      return;
    case "diff":
      return runDiff(flags);
    case "mcp":
      // Speak MCP on stdio: the same comparison, for any agent client.
      return runMcp();
    case "hook:claude-pre":
    case "hook:claude-post": {
      // Claude Code's PostToolUse/PreToolUse hooks. A terminal has no slot a card can be drawn
      // into, so this prints the same comparison the card describes, in the place the person is
      // already reading. Both read the hook payload on stdin.
      {
        const m = await import("./claude-hook.js");
        if (cmd === "hook:claude-pre") m.runSnapshot();
        else await m.runPost();
      }
      return;
    }
    case "local":
    case "inbox":
      return runServer({ ...flags, route: cmd === "inbox" ? "inbox" : flags.route });
    case "help":
    case "--help":
    case "-h":
      return printHelp();
    default:
      return printHelp();
  }
}

function printHelp() {
  console.log(`diffs ${DIFFS_VERSION} — local-first diff for everything

  diffs local [--port ${LOCAL_DEFAULT_PORT}] [--no-open]   start the viewer (default)
  diffs inbox [--open]                      start and jump to the inbox
  diffs diff <old> <new> [--unified]        compare two files in the terminal
  diffs mcp                                 run as an MCP server (stdio) for agent clients
  diffs paths                               where data lives (~/.diffs)
  diffs version
`);
}

interface Flags {
  positional: string[];
  port?: number;
  open?: boolean;
  unified?: boolean;
  /** A git revision to compare the file against, instead of a second file. */
  revision?: string;
  /** Lines of context per hunk (0–20). */
  context?: number;
  /** Cap on the number of hunks (1–200). */
  maxHunks?: number;
  json?: boolean;
  route?: string;
  [key: string]: unknown;
}

function parseFlags(args: string[]): Flags {
  const flags: Flags = { positional: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--port") flags.port = Number(args[++i]);
    else if (a === "--no-open") flags.open = false;
    else if (a === "--open") flags.open = true;
    else if (a === "--unified") flags.unified = true;
    else if (a === "--revision") flags.revision = args[++i];
    else if (a === "--context") flags.context = Number(args[++i]);
    else if (a === "--maxHunks") flags.maxHunks = Number(args[++i]);
    else if (a === "--json") flags.json = true;
    else if (a.startsWith("--")) flags[a.slice(2)] = true;
    else flags.positional.push(a);
  }
  return flags;
}

async function runServer(flags: Flags): Promise<void> {
  const { startLocalServer } = await import("@diffs/diff-tool/server");
  const staticDir = path.resolve(HERE, "../../local/out");
  const server = await startLocalServer({
    staticDir,
    port: flags.port ?? LOCAL_DEFAULT_PORT,
    onReady: ({ url }) => {
      const target = flags.route === "inbox" ? `${url}/#/inbox` : url;
      console.log(`diffs.work local → ${target}`);
      console.log(`  static: ${staticDir}`);
      console.log(`  data:   ${diffsHome()}`);
      if (flags.open !== false) openBrowser(target);
    },
  });
  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function runDiff(flags: Flags): Promise<void> {
  const [oldFile, newFile] = flags.positional;
  // `--revision` makes the second path optional: the comparison is against a commit.
  if (!oldFile || (!newFile && typeof flags.revision !== "string")) {
    console.error("usage: diffs diff <old> <new> [--unified] [--json]\n       diffs diff <file> --revision <rev>");
    process.exit(1);
  }
  // A raw ENOENT is technically accurate and useless to the person who typed the wrong path.
  // Name the file that is wrong and what to do about it.
  const exists = (p: string) => existsSync(p);
  for (const p of [oldFile, newFile].filter((x): x is string => Boolean(x))) {
    if (!exists(p) && !flags.revision) {
      console.error(`diffs: cannot read ${p} — no such file. Check the path, or use --revision to compare against a commit.`);
      process.exit(1);
    }
    if (exists(p) && statSync(p).isDirectory()) {
      console.error(`diffs: ${p} is a directory. Point at the two files, not a folder.`);
      process.exit(1);
    }
  }
  const r = await compareFiles({
    old: oldFile,
    new: newFile,
    revision: typeof flags.revision === "string" ? flags.revision : undefined,
    context: typeof flags.context === "number" && Number.isFinite(flags.context) ? flags.context : undefined,
    maxHunks: typeof flags.maxHunks === "number" && Number.isFinite(flags.maxHunks) ? flags.maxHunks : undefined,
    format: flags.unified ? "unified" : "json",
  });
  if (flags.json) {
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  // `--unified` prints the patch and nothing else: the docs promise it can go straight into
  // `patch`, and a summary line in front of a patch makes the whole thing unusable for that.
  if (flags.unified) {
    if (r.unified) {
      console.log(r.unified);
      return;
    }
    // No patch for this family. Printing a summary instead would hand `patch` a file it cannot
    // read — and the caller would believe they had a patch, because that is what was asked for.
    console.error(
      `diffs: --unified needs a line-based patch, and ${r.family} does not have one. ` +
        `Drop --unified to see its structured result, or use --json.`,
    );
    process.exit(1);
  }
  // `--open` was documented as the way to read a pair "in this site's view" — including the
  // git difftool recipe on the config page — but runDiff never read the flag, so it printed to
  // the terminal and nothing opened. The viewer is a server, so honour it here.
  if (flags.open) {
    await openInViewer(oldFile, newFile);
    return;
  }

  console.log(`${r.oldLabel} → ${r.newLabel}`);
  console.log(summarizeThin(r));
  if (r.unified) console.log(`\n${r.unified}`);
  // for the Office families the summary *is* the note, so printing both says it twice
  else if (r.note && r.note !== r.summary) console.log(r.note);
  else {
    for (const h of r.hunks.slice(0, 10)) {
      console.log(`\n${h.header}`);
      for (const l of h.lines.slice(0, 40)) {
        console.log(`${l.kind === "insert" ? "+" : l.kind === "delete" ? "-" : " "}${l.text}`);
      }
    }
    if (r.hunks.length > 10) console.log(`\n… 还有 ${r.hunks.length - 10} 处差异`);
  }
}

/**
 * Read a pair in the local viewer: POST it to the running server and open that page.
 *
 * If no server is running, start one on the default port first — `git difftool` invokes this
 * cold, with no viewer in the background.
 */
async function openInViewer(oldFile: string, newFile: string): Promise<void> {
  const base = `http://127.0.0.1:${LOCAL_DEFAULT_PORT}`;
  const alive = async () => {
    try {
      const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(600) });
      return r.ok;
    } catch {
      return false;
    }
  };
  if (!(await alive())) {
    // `git difftool` runs this cold, with no viewer in the background. Starting one is what the
    // reader means by "--open"; failing here made the documented recipe depend on a second
    // terminal nobody had opened.
    const child = spawn(process.execPath, [process.argv[1] ?? "", "local", "--no-open"], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    for (let i = 0; i < 40 && !(await alive()); i += 1) await new Promise((r) => setTimeout(r, 250));
    if (!(await alive())) {
      console.error(`diffs: could not start the viewer on ${base}. Run "diffs local" by hand.`);
      process.exit(1);
    }
  }
  // POST /api/pair, not /api/open: /api/open records an entry for the inbox list, while the
  // viewer reads `/api/pair/:id` to fill the two panes. Posting to the wrong one produced a link
  // that opened an empty comparison.
  const read = async (f: string) => readFile(f).then((b) => b.toString("base64"));
  const r = await fetch(`${base}/api/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      oldBase64: await read(oldFile),
      oldName: path.basename(oldFile),
      newBase64: await read(newFile),
      newName: path.basename(newFile),
    }),
  });
  if (!r.ok) {
    console.error(`diffs: the viewer refused the pair (HTTP ${r.status})`);
    process.exit(1);
  }
  const { url } = (await r.json()) as { url: string };
  const target = `${base}${url}`;
  console.log(`diffs.work → ${target}`);
  openBrowser(target);
}

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* headless: the URL is printed above */
  }
}

/** Read a small JSON file, returning null on any failure (used by tests). */
export async function readJsonFile(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}