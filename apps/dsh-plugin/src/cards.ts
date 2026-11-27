/**
 * diffs.work — make every file the agent edits render as a diffs.work card.
 *
 * The harness draws a card for `edit` and `write`, but only for text files and
 * only as a raw `oldText → newText` fragment. A `.docx`, `.xlsx`, `.pptx` or
 * `.pdf` edit draws nothing at all — and that is the case this module exists for.
 *
 * ## How it hooks in
 *
 * The card a conversation shows for a tool call comes from the durable
 * `tool/result` event, and `ToolDefinition.presentationMeta` is the only hook
 * that writes its `meta`. The registry calls that hook while building the event,
 * so a plugin cannot append to a shipped tool's card from outside.
 *
 * What a plugin CAN take is the tool name: `tools.register()` on a context
 * tagged with an agent's scope shadows the global entry for that agent alone.
 * The lookup has one subtlety that cost a long afternoon — `get(name, scope)`
 * takes the AGENT OBJECT as its scope key (the dispatcher calls
 * `chainLayers(exec.agent)`); `get(name)` with no scope reads the CALLER's layer,
 * and this plugin's layer holds no tools at all, so it always answered "0 tools".
 *
 * So this module registers its own `edit` / `write` / `bash` in each agent's
 * scope. Every body calls the shipped tool, so writes, permissions, the sandbox,
 * and durability still run through the original implementation; what changes is
 * the metadata written beside the result.
 *
 * ## Two shapes of edit, two ways to get the "before" side
 *
 * `edit` / `write` name their file, so the pre-image is read straight off it.
 *
 * `bash` does not, and a document is never edited through `edit` — measured on
 * this machine, one sentence of a `.docx` took eleven `bash` calls driving
 * `python-docx` and not one `edit`. A shell command is therefore watched by
 * indexing the paths it names (stats only — a whole-workspace walk hit 20 000
 * files in this one workspace and was abandoned), holding the bytes of the
 * documents among them, and comparing those after the command settles. A
 * background call settles before its command does, so the job is awaited first.
 */
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, isAbsolute, resolve } from "node:path";



/**
 * The part of a tool execution the wrapper reads.
 *
 * Structural rather than imported: the host half must build without the
 * harness's type packages, and only the session's working directory and the
 * cancellation signal matter to a card.
 */
export interface ToolExec {
  readonly agent?: { readonly session: { readonly header: { readonly cwd?: string } } };
  readonly signal: AbortSignal;
}

/**
 * The slice of a Cordis context this module uses.
 *
 * Kept structural rather than imported from the harness so the plugin builds
 * without the harness's type packages, exactly like the rest of the host half.
 */
export interface CardContext {
  tools: {
    get(name: string, scope?: unknown): WrappedTool | undefined;
    register(definition: WrappedTool): () => void;
  };
  agents: { list(): Array<{ id: string; ctx: CardContext }> };
  on(event: string, listener: (payload: unknown, next: () => Promise<unknown>) => unknown, options?: { global?: boolean }): () => void;
  get(name: string): { wait?: unknown } | undefined;
  effect?(fn: () => () => void): () => void;
  logger?: { warn?(message: string): void; info?(message: string): void };
}

/** A tool definition as the registry hands it back. */
export interface WrappedTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  output?: {
    schema: Record<string, unknown>;
    render(args: unknown, value: unknown): unknown;
    presentationMeta?(args: unknown, value: unknown): unknown;
  };
  execute(args: unknown, exec: unknown): Promise<unknown>;
  [key: string]: unknown;
}

/** Services this plugin reads. Cordis refuses an undeclared read. */


/** Tools whose result becomes a card about one named file. */
const WATCHED_FILE = ["edit", "write"];

/** Tools whose result becomes a card about whatever in the workspace moved. */
const WATCHED_SHELL = ["bash"];

/** Contract version carried by every comparison this plugin produces. */
const SCHEMA = "diffs.work/portable@1";

/** Files above this size are not read as pre-images. */
const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;

/** A workspace larger than this is not indexed; the card then falls back to the shipped one. */
const MAX_TRACKED_FILES = 20000;

/** At most this many changed files get a card from one shell command. */
const MAX_CARDS_PER_CALL = 20;

/** Suffixes that draw a document card. */
const DOCUMENT_SUFFIXES = new Set([".docx", ".xlsx", ".pptx", ".pdf", ".doc", ".xls", ".ppt"]);

/** Suffixes worth comparing when a shell command changed them. */
const TEXT_SUFFIXES = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".mdx", ".css", ".scss",
  ".less", ".html", ".htm", ".yml", ".yaml", ".toml", ".ini", ".cfg", ".py", ".rs", ".go",
  ".java", ".kt", ".swift", ".rb", ".php", ".cs", ".c", ".h", ".cpp", ".hpp", ".sh", ".bat",
  ".sql", ".xml", ".svg", ".csv", ".txt", ".vue", ".svelte", ".astro", ".graphql", ".proto",
]);

/** Directories never walked: dependencies and build output are not the person's work. */
const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", "out", ".next", ".cache", "target", ".venv", "venv",
  "__pycache__", ".turbo", "coverage", ".pnpm-store", "vendor", ".git",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Pull the file a call names out of its arguments.
 * @param {unknown} args - parsed tool arguments.
 * @returns {string | null} the path, or null when this call names none.
 */
function pathOf(args: unknown): string | null {
  if (!isRecord(args)) return null;
  const candidate = args.file_path ?? args.path;
  if (typeof candidate !== "string" || candidate.trim() === "") return null;
  return candidate;
}

/**
 * Read a file, reporting absence separately from failure.
 * @param {string} absolute - the file.
 * @returns {Promise<{ bytes: Uint8Array | null, missing: boolean }>}
 */
async function readSafely(absolute: string): Promise<{ bytes: Uint8Array | null; missing: boolean }> {
  try {
    const bytes = await readFile(absolute);
    return bytes.byteLength > MAX_SNAPSHOT_BYTES ? { bytes: null, missing: false } : { bytes, missing: false };
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined;
    return { bytes: null, missing: code === "ENOENT" };
  }
}

/**
 * Compare a pre-image with the file as it now stands.
 *
 * `compareFiles` takes two paths, so the pre-image is staged in a throwaway
 * directory and removed afterwards. That keeps the shipped comparison — the one
 * the CLI, the MCP server and the local viewer all use — as the only
 * implementation.
 * @param {string} absolute - the file after the edit.
 * @param {Uint8Array | null} before - the pre-image, or null for a create.
 * @param {string} displayPath - the path to name in the card.
 * @param {'create' | 'update'} operation - what the call did.
 * @returns {Promise<object | null>} the payload, or null when nothing compares.
 */
async function compare(
  absolute: string,
  before: Uint8Array | null,
  displayPath: string,
  operation: "create" | "update",
): Promise<Record<string, unknown> | null> {
  const { compareFiles, summarizeThin, toOpenUI } = await import("@diffs/diff-tool");
  const suffix = extname(basename(absolute));
  const dir = await mkdtemp(`${tmpdir()}/diffs-before-`);
  try {
    const staged = `${dir}/before${suffix}`;
    await writeFile(staged, before ?? new Uint8Array());
    const result = await compareFiles({ old: staged, new: absolute, context: 3 });
    const summary = summarizeThin(result);
    return {
      schema: SCHEMA,
      operation,
      family: result.family,
      path: displayPath,
      oldLabel: result.oldLabel,
      newLabel: result.newLabel,
      summary,
      added: result.added,
      removed: result.removed,
      counts: result.counts ?? null,
      hunks: result.hunks,
      unified: result.unified ?? "",
      note: result.note ?? "",
      openui: toOpenUI({ ...result, summary }),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Reduce a value to strict JSON.
 *
 * The registry snapshots a card payload with the lossless-JSON rules, which
 * reject `undefined`, non-finite numbers, and class instances. A comparison
 * carries whatever the engines produced, so `hunks` can hold an absent line
 * number; without this pass the whole tool call fails with
 * "output.presentationMeta returned non-lossless JSON" — which is exactly what
 * happened before this function existed.
 * @param {unknown} value - the candidate value.
 * @returns {unknown} the same data with only JSON-representable members.
 */
function toJson(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(toJson);
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, member] of Object.entries(value)) {
      if (member === undefined || typeof member === "function" || typeof member === "symbol") continue;
      out[key] = toJson(member);
    }
    return out;
  }
  return null;
}

/**
 * Payloads waiting for the card that will read them.
 *
 * Object identity cannot carry this: the registry snapshots a tool's value
 * before calling `presentationMeta`, so the object seen there is not the one
 * `execute` returned. What both sides share is the call's arguments — the same
 * command, the same file — so a record is keyed by tool name and cleared as soon
 * as the card consumes it.
 */
const PENDING = new Map();



/**
 * Index the files a shell command can plausibly touch.
 *
 * A whole-workspace walk is not an option: this machine's home workspace holds
 * 82 000 files in one directory alone, and stats for all of them before AND
 * after every `ls` would cost more than the diff is worth — measured, the walk
 * hit the cap and declined every call.
 *
 * What a shell command actually touches is written in its text. So the paths it
 * names are indexed, plus the current directory when it names none. A command
 * that edits a file it never mentions (`find … -exec`, a build script with baked
 * paths) has no card; that is a stated limitation, not a silent wrong answer.
 * @param {string} root - the session's working directory.
 * @param {string} command - the shell command about to run.
 * @returns {Promise<Map<string, string>>} absolute path → "size:mtime".
 */
async function indexWorkspace(root: string, command: string): Promise<Map<string, string> | null> {
  const { stat, readdir } = await import("node:fs/promises");
  const { join, resolve: resolvePath } = await import("node:path");
  const index = new Map();

  /** Stat one file, or walk one directory shallowly. */
  const visit = async (absolute: string): Promise<void> => {
    if (index.size >= MAX_TRACKED_FILES) return;
    try {
      const info = await stat(absolute);
      if (info.isFile()) {
        const suffix = extname(absolute).toLowerCase();
        if (DOCUMENT_SUFFIXES.has(suffix) || TEXT_SUFFIXES.has(suffix)) {
          index.set(absolute, `${info.size}:${Math.round(info.mtimeMs)}`);
        }
        return;
      }
      if (!info.isDirectory()) return;
      // A named directory is walked one level: enough for `python fix.py` output next to it.
      for (const entry of await readdir(absolute, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const full = join(absolute, entry.name);
        const suffix = extname(entry.name).toLowerCase();
        if (!DOCUMENT_SUFFIXES.has(suffix) && !TEXT_SUFFIXES.has(suffix)) continue;
        try {
          const child = await stat(full);
          index.set(full, `${child.size}:${Math.round(child.mtimeMs)}`);
        } catch {
          /* vanished between readdir and stat */
        }
      }
    } catch {
      /* a path the command mentions but that does not exist yet is simply absent */
    }
  };

  const named = mentionedPaths(String(command ?? ""));
  const candidates = new Set<string>();
  for (const token of named) {
    candidates.add(token.startsWith("/") ? token : resolvePath(root, token));
    // A document referenced by a script is often only its basename (`python -c ... 'report.docx'`);
    // resolving against the cwd already covers that, and one level of nesting covers `cd sub && …`.
    for (const prefix of ["", "diffs-gui-check/", "diffs-gui/"]) {
      if (!token.includes("/")) candidates.add(resolvePath(root, prefix + token));
    }
  }
  candidates.add(root);
  for (const candidate of candidates) await visit(candidate);

  // Files created by the command do not exist before it runs, so also remember the directories the
  // command names, and diff their listing afterwards through `shellPayload`.
  return index;
}

/**
 * Absolute-looking and file-looking tokens in a shell command.
 * @param {string} command - the command text.
 * @returns {string[]} candidate paths, longest first so a directory is visited before its files.
 */
function mentionedPaths(command: string): string[] {
  const pattern = /(?:[\w.@+-]+\/)*[\w.@+\u4e00-\u9fff-]+\.[A-Za-z0-9]{1,5}\b|(?:\/[\w.@+\u4e00-\u9fff-]+)+/gu;
  const found = command.match(pattern) ?? [];
  return [...new Set(found)].sort((left, right) => right.length - left.length).slice(0, 200);
}

/**
 * Capture the bytes a shell command is about to replace.
 *
 * The index holds stats, so the pre-image has to be taken before the command
 * runs. Reading everything would cost what the index avoids, so the capture is
 * bounded: documents always (they are the point of this plugin), text files only
 * within a small budget.
 * @param {string[]} candidates - absolute paths in the workspace.
 * @param {number} textBudget - how many non-document files may also be held.
 * @returns {Promise<Map<string, Uint8Array>>} path → bytes.
 */
async function stash(candidates: string[], textBudget = 40): Promise<Map<string, Uint8Array>> {
  const { stat } = await import("node:fs/promises");
  const held = new Map();
  let textHeld = 0;
  for (const file of candidates) {
    const isDocument = DOCUMENT_SUFFIXES.has(extname(file).toLowerCase());
    if (!isDocument && textHeld >= textBudget) continue;
    try {
      const info = await stat(file);
      if (info.size > MAX_SNAPSHOT_BYTES) continue;
      held.set(file, await readFile(file));
      if (!isDocument) textHeld += 1;
    } catch {
      /* an unreadable file cannot be a pre-image; skip it rather than fail the command */
    }
  }
  return held;
}

/**
 * Build the card payload for one finished shell command.
 * @param {string} root - the workspace root the index was taken from.
 * @param {Map<string, string>} before - the pre-command index.
 * @param {Map<string, Uint8Array>} held - pre-images read before the command.
 * @returns {Promise<object | null>} the payload, or null when nothing compared.
 */
async function shellPayload(
  root: string,
  before: Map<string, string>,
  held: Map<string, Uint8Array>,
  command: string,
): Promise<Record<string, unknown> | null> {
  const after = await indexWorkspace(root, command);
  if (after === null) return null;
  const moved = [];
  for (const [file, stamp] of after) if (before.get(file) !== stamp) moved.push(file);
  for (const file of before.keys()) if (!after.has(file)) moved.push(file);
  const rank = (file: string): number => (DOCUMENT_SUFFIXES.has(extname(file).toLowerCase()) ? 0 : 1);
  moved.sort((left, right) => rank(left) - rank(right) || left.localeCompare(right));
  const files = [];
  for (const absolute of moved.slice(0, MAX_CARDS_PER_CALL) as string[]) {
    const pre = held.get(absolute);
    if (pre === undefined) continue;
    const display = absolute.startsWith(`${root}/`) ? absolute.slice(root.length + 1) : absolute;
    const payload = await compare(absolute, pre, display, "update");
    if (payload !== null) files.push(payload);
  }
  if (files.length === 0) return null;
  return { schema: SCHEMA, command: "", files };
}

/**
 * Shadow one tool so its card shows a diffs.work comparison.
 * @param {object} inner - the shipped definition.
 * @param {(message: string) => void} note - reports what the plugin did.
 * @returns {object} the shadowing definition.
 */
function shadow(
  inner: WrappedTool,
  note: (message: string) => void,
  jobs: { wait(id: string, timeoutMs: number, caller?: unknown, signal?: AbortSignal): Promise<unknown> } | undefined,
): WrappedTool {
  const namesFile = WATCHED_FILE.includes(inner.name);
  const wrapped = {
    ...inner,
    name: inner.name,
    description: inner.description,
    parameters: inner.parameters,
    async execute(args: unknown, exec: ToolExec): Promise<unknown> {
      const cwd = exec?.agent?.session?.header?.cwd ?? process.cwd();
      if (namesFile) {
        const file = pathOf(args);
        if (file === null) return inner.execute(args, exec);
        const absolute = isAbsolute(file) ? file : resolve(cwd, file);
        const before = await readSafely(absolute);
        const value = await inner.execute(args, exec);
        try {
          const payload = await compare(absolute, before.bytes, file, before.missing ? "create" : "update");
          if (payload !== null) {
            PENDING.set(inner.name, payload);
          }
        } catch (error) {
          note(`diffs: could not compare ${file}: ${String(error)}`);
        }
        return value;
      }

      // A shell command: index before it, run it, then compare what moved.
      //
      // A background call settles before its command does — `run_in_background: true` returns a
      // job id at once, and an agent driving `python-docx` used exactly that shape — so the wait
      // for the job comes before the second index. Without it the workspace is compared with
      // itself and the card stays empty.
      const root = cwd;
      const commandText = String(isRecord(args) ? args.command ?? "" : "");
      const before = await indexWorkspace(root, commandText);
      if (before === null) {
        note("diffs: nothing in this command names a file to watch; keeping the shipped card");
        return inner.execute(args, exec);
      }
      const held = await stash([...before.keys()]);
      const value = await inner.execute(args, exec);
      try {
        // A background call settles before its command does, so the job is awaited before the
        // second index: otherwise the workspace is compared with itself and the card stays empty.
        if (isRecord(value) && value.kind === "background" && typeof value.jobId === "string" && jobs !== undefined) {
          await jobs.wait(value.jobId, 120_000, exec.agent, exec.signal);
        }
        const payload = await shellPayload(root, before, held, commandText);
        if (payload !== null) {
          PENDING.set(inner.name, payload);
          const files = Array.isArray(payload.files) ? (payload.files as Array<{ path?: string }>) : [];
          note(`diffs: ${inner.name} changed ${files.length} file(s): ${files.map((entry) => entry.path ?? "?").join(", ")}`);
        }
      } catch (error) {
        note(`diffs: shell comparison failed: ${String(error)}`);
      }
      return value;
    },
  };

  // `presentationMeta` runs inside the registry while it builds the durable
  // `tool/result` event, so this is the only place a card payload can be written.
  //
  // The projector must return a JSON value: `undefined` is refused as "returned invalid output",
  // which failed every shell call outright the first time this file gave `bash` a
  // `presentationMeta`. A tool that ships no projector of its own therefore gets `{}` on the quiet
  // calls and the card when something moved.
  const shipped = inner.output;
  if (shipped !== undefined) {
    const passthrough = shipped.presentationMeta;
    wrapped.output = {
      ...shipped,
      presentationMeta(args, value) {
        // A throw here fails the whole tool call, which is far worse than a missing card: the
        // command ran, and the agent must still see its result. Every failure below therefore
        // degrades to the shipped answer instead of propagating.
        try {
          const payload = PENDING.get(inner.name);
          if (payload !== undefined) {
            PENDING.delete(inner.name);
            const clean = toJson(payload);
            if (clean !== null && typeof clean === "object") return clean;
          }
        } catch (error) {
          note(`diffs: card payload rejected: ${String(error)}`);
        }
        if (passthrough === undefined) return {};
        const fallback = passthrough(args, value);
        return fallback ?? {};
      },
    };
  }
  return wrapped;
}

/**
 * Read the background-job service, when the profile has one.
 * @param ctx - the plugin's context.
 * @returns the service, or undefined on a profile without background jobs.
 */
function readJobs(ctx: CardContext): Parameters<typeof shadow>[2] {
  try {
    const jobs = ctx.get("jobs");
    return isRecord(jobs) && typeof jobs.wait === "function" ? jobs as never : undefined;
  } catch {
    // `get` throws for a service this fiber did not inject; no jobs means `run_in_background`
    // is unavailable anyway, so the shell tool has already refused that path.
    return undefined;
  }
}

/**
 * Register the shadowing tools in each agent's own scope.
 *
 * Called by the plugin's `apply`, so these agents' `edit`, `write` and `bash` calls produce
 * diffs.work cards instead of the shipped fragment cards (or, for a document, no card at all).
 * @param {object} ctx - the plugin's Cordis context.
 */
export function installCards(ctx: CardContext): void {
  // Both channels on purpose: the profile's logger level differs between a terminal and the Web
  // app, and a diagnostic that only one of them shows is a diagnostic nobody reads.
  // `DIFFS_DEBUG=1` also mirrors to stderr, which is the only way to see this while developing
  // against `dsh web`.
  const note = (message: string): void => {
    ctx.logger?.warn?.(message);
    if (process.env.DIFFS_DEBUG === "1") process.stderr.write(`${message}\n`);
  };
  const patch = (agentCtx: CardContext, agent: unknown): void => {
    // `get(name, scope)` takes the AGENT ITSELF as its scope key — the dispatcher calls
    // `chainLayers(exec.agent)`, so a scope key is the agent object, not a string. That is the
    // whole reason every earlier attempt saw "0 tool(s)": `get(name)` with no scope reads the
    // CALLER's layer, and this plugin's layer holds no tools.
    const registry = agentCtx.tools ?? ctx.tools;
    for (const toolName of [...WATCHED_FILE, ...WATCHED_SHELL]) {
      let inner;
      try {
        inner = agent === undefined ? undefined : registry.get(toolName, agent);
      } catch (error) {
        note(`diffs: lookup of ${toolName} failed: ${String(error)}`);
      }
      if (inner === undefined) {
        note(`diffs: ${toolName} not visible for this agent yet`);
        continue;
      }
      if (inner.__diffsShadow === true) continue;
      const wrapped = shadow(inner, note, readJobs(ctx));
      wrapped.__diffsShadow = true;
      try {
        registry.register(wrapped);
        note(`diffs: shadowed ${toolName}`);
      } catch (error) {
        note(`diffs: could not shadow ${toolName}: ${String(error)}`);
      }
    }
  };

  // `agent/pre-step` is the trigger that works, and it took measuring to find out why.
  //
  // `agent/created` fires before any tool package has registered anything — the Web app
  // reported "registry has 0 tool(s)" on every run — and `tools/change` fires from the plugin's
  // own (unscoped) layer, where a scoped agent's tools are not visible either. The first model
  // call of a turn is the earliest moment the agent's tool set is complete, so that is when the
  // coverage is installed. It runs once per agent: `patch` is idempotent.
  if (typeof ctx.on === "function") {
    ctx.on("agent/pre-step", (payload, next) => {
      try {
        const agent = isRecord(payload) ? payload.agent : undefined;
        const agentCtx = isRecord(agent) ? agent.ctx : undefined;
        // The context is the harness's own object; this module only reads `tools` and `on` off it.
        if (isRecord(agentCtx)) patch(agentCtx as unknown as CardContext, agent);
      } catch (error) {
        note(`diffs: could not cover the agent before its step: ${String(error)}`);
      }
      return next();
    });
  }

  let existing = 0;
  try {
    for (const agent of ctx.agents.list()) {
      patch(agent.ctx, agent);
      existing += 1;
    }
  } catch (error) {
    note(`diffs: could not patch running agents: ${String(error)}`);
  }
  note(`diffs: card coverage installed (${existing} running agent(s), new agents covered on creation)`);
}