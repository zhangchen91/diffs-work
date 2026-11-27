/**
 * diffs.work for DeepSeek Harness.
 *
 * Registers, in the profile's Cordis context:
 *
 *   tools.register(diff_compare)   the agent can diff two files and get a
 *                                  structured result (hunks, line numbers,
 *                                  +/- counts, changed symbols) — no upload,
 *                                  everything read from disk on this machine.
 *   commands.register(/diff-open)  a person opens the two files in the local
 *                                  diffs.work viewer (diffs local).
 *   commands.register(/diff-last)  diff the working tree against HEAD~1 for the
 *                                  file named in the command line.
 *
 * Every comparison that returns a diff is also recorded in the local inbox
 * (~/.diffs/diffs/*.json) when `diffs local` is running, so the person can find
 * it later. Nothing here is required for the tool to work: the inbox is a
 * best-effort side channel.
 *
 * The module follows the same shape as every DSH Cordis plugin: export `name`
 * and `apply(ctx, config)`; the loader reads this module's exports as the plugin.
 */

import { compareFiles, summarizeThin, toOpenUI, type CompareInput } from "@diffs/diff-tool";
import { diffsHome } from "@diffs/shared";

export const name = "diffs";

/** Local viewer address; `diffs local` listens here. */
export const DEFAULT_LOCAL_URL = "http://127.0.0.1:5279";

export interface DiffsConfig {
  localUrl?: string;
  tool?: boolean;
  commands?: boolean;
}

/** The narrow slice of the Cordis context this plugin touches. */
export interface DshContext {
  tools?: { register(definition: DshToolDefinition): unknown };
  commands?: { register(definition: DshCommandDefinition): unknown };
  logger?: { info?(msg: string): void; warn?(msg: string): void };
  get?(name: string): unknown;
  effect?(fn: () => () => void): void;
}

export interface DshToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  output: {
    schema: Record<string, unknown>;
    render(args: unknown, value: unknown): Array<{ type: "text"; text: string }>;
  };
  execute(args: unknown, exec?: { agent?: { id?: string }; signal?: AbortSignal; cwd?: string }): Promise<unknown>;
}

export interface DshCommandDefinition {
  name: string;
  description: string;
  input?: { hint: string };
  handler(invocation: { agent?: { id?: string; cwd?: string }; rawInput: string; signal?: AbortSignal }):
    | Promise<{ kind: "success"; text?: string } | { kind: "error"; text: string }>
    | { kind: "success"; text?: string }
    | { kind: "error"; text: string };
}

// Name, description and input schema come from the shared contract: this file used to carry its
// own copy that told an agent Office and PDF were "not compared inline" while the MCP server
// advertised them as supported. One agent-facing description, in @diffs/diff-tool.
import { DIFF_TOOL_NAME, DIFF_TOOL_DESCRIPTION, DIFF_TOOL_INPUT_SCHEMA as SharedInput } from "@diffs/diff-tool";
export { DIFF_TOOL_NAME, DIFF_TOOL_DESCRIPTION };

/** The plugin's tool config uses `parameters`; the shared contract calls it `inputSchema`. */
export const DIFF_TOOL_PARAMETERS: Record<string, unknown> = SharedInput as unknown as Record<string, unknown>;

export const DIFF_TOOL_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["text", "code", "binary"] },
    family: { type: "string" },
    oldLabel: { type: "string" },
    newLabel: { type: "string" },
    added: { type: "number" },
    removed: { type: "number" },
    summary: { type: "string" },
    truncated: { type: "boolean" },
    unified: { type: "string" },
    /** the same comparison as OpenUI Lang, for any surface with an adapter */
    openui: { type: "string" },
    note: { type: "string" },
  },
  required: ["kind", "added", "removed", "summary"],
  additionalProperties: true,
};

function toModelText(value: unknown): string {
  const v = value as Record<string, unknown> | null;
  if (!v) return "";
  if (typeof v.unified === "string" && v.unified) return v.unified;
  const lines: string[] = [];
  if (typeof v.summary === "string") lines.push(v.summary);
  // For an Office result the summary *is* the note; pushing both printed the same sentence twice.
  if (typeof v.note === "string" && v.note !== v.summary) lines.push(v.note);
  const hunks = (v.hunks as Array<{ header: string; lines: Array<{ kind: string; text: string }> }> | undefined) ?? [];
  for (const h of hunks.slice(0, 12)) {
    lines.push(h.header);
    for (const l of h.lines.slice(0, 60)) {
      lines.push((l.kind === "insert" ? "+" : l.kind === "delete" ? "-" : " ") + l.text);
    }
  }
  if (hunks.length > 12) lines.push(`… 还有 ${hunks.length - 12} 处差异（完整结果见 JSON / 本地站）`);
  return lines.join("\n");
}

function sessionCwdOf(ctx: DshContext, exec?: { agent?: { cwd?: string } }): string | undefined {
  const fromExec = exec?.agent?.cwd;
  if (typeof fromExec === "string" && fromExec) return fromExec;
  // Not `ctx.get("workspace")`: reading a service that was not declared with `inject` throws
  // `cannot get property "toJSON" without inject` at call time, which failed every comparison that
  // passed a relative path. process.cwd() is what the host already runs in.
  return undefined;
}

async function recordInbox(
  ctx: DshContext,
  localUrl: string,
  title: string,
  oldPath: string,
  newPath: string,
): Promise<void> {
  try {
    const res = await fetch(`${localUrl.replace(/\/$/, "")}/api/inbox`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title,
        old: { label: oldPath, path: oldPath },
        new: { label: newPath, path: newPath },
        source: "@diffs/dsh-plugin",
      }),
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) ctx.logger?.warn?.(`diffs: inbox responded ${res.status}`);
  } catch {
    // `diffs local` is not running — the tool works without it.
  }
}

export function createDiffTool(ctx: DshContext, config: Required<DiffsConfig>): DshToolDefinition {
  return {
    name: DIFF_TOOL_NAME,
    description: DIFF_TOOL_DESCRIPTION,
    parameters: DIFF_TOOL_PARAMETERS,
    output: {
      schema: DIFF_TOOL_OUTPUT_SCHEMA,
      render(_args: unknown, value: unknown) {
        // Two blocks on purpose: the first is what the model reads (the unified
        // text), the second is the JSON payload the browser card parses to draw
        // 增/删/改/移 and column-level hits.
        // Two blocks: the prose the model reads, then the JSON the browser card parses to draw
        // 增/删/改/移. Dropping the second one made the card show "+0 -0 两版内容一致", because it
        // reads the payload from here — the host does not hand it the structured value.
        const blocks: Array<{ type: "text"; text: string }> = [{ type: "text", text: toModelText(value) }];
        try {
          blocks.push({ type: "text", text: JSON.stringify(value) });
        } catch {
          /* nothing to add */
        }
        return blocks;
      },
    },
    async execute(args: unknown, invocation?: { agent?: { cwd?: string } }) {
      const a = (args ?? {}) as CompareInput;
      const input: CompareInput = {
        old: a.old,
        new: a.new,
        revision: a.revision,
        context: a.context,
        maxHunks: a.maxHunks,
        format: a.format,
        // The agent names files relative to its session, which is not this process's cwd. Without
        // this, `test-cases/a.docx` resolved against the plugin host's directory and the call came
        // back NOT COMPARED — while the same relative path worked from the CLI.
        cwd: a.cwd ?? sessionCwdOf(ctx, invocation),
      };
      const result = await compareFiles(input);
      const summary = summarizeThin(result);
      // Every family is recorded, not only text: a .docx comparison was skipped here, so the
      // "对比" counter stayed at 0 and the card never appeared for exactly the files the plugin
      // is most useful for.
      {
        const cwd = input.cwd ?? process.cwd();
        const oldLabel = result.oldLabel.replace(/@.*$/, "");
        void recordInbox(
          ctx,
          config.localUrl,
          `${oldLabel} → ${result.newLabel}`,
          `${cwd}/${oldLabel}`,
          `${cwd}/${result.newLabel}`,
        );
      }
      // Describe the result after `summary` is normalised, so the card and the prose agree.
      return { ...result, summary, openui: toOpenUI({ ...result, summary }) };
    },
  };
}

export function createCommands(ctx: DshContext, config: Required<DiffsConfig>): DshCommandDefinition[] {
  return [
    {
      name: "diff-open",
      description: "在本地 diffs.work 里打开两个文件（或 Inbox）",
      input: { hint: "<old> <new>  ·  留空则打开 Inbox" },
      async handler({ rawInput, agent }) {
        const parts = rawInput.trim().split(/\s+/).filter(Boolean);
        const base = config.localUrl.replace(/\/$/, "");
        if (parts.length === 0) {
          return { kind: "success", text: `Inbox: ${base}/#/inbox` };
        }
        if (parts.length !== 2) {
          return { kind: "error", text: "用法：/diff-open <old> <new>（或留空打开 Inbox）" };
        }
        const [oldPath, newPath] = parts;
        const cwd = agent?.cwd ?? process.cwd();
        try {
          const res = await fetch(`${base}/api/open`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              title: `${oldPath} → ${newPath}`,
              old: { label: oldPath, path: `${cwd}/${oldPath}` },
              new: { label: newPath, path: `${cwd}/${newPath}` },
              source: "/diff-open",
            }),
            signal: AbortSignal.timeout(1500),
          });
          if (!res.ok) {
            return { kind: "error", text: `本地站返回 ${res.status}。先运行 \`diffs local\`。` };
          }
          const { url } = (await res.json()) as { url: string };
          return { kind: "success", text: `已打开：${base}${url}` };
        } catch {
          return {
            kind: "error",
            text: `连不上本地站 ${base}。先在终端运行 \`diffs local\`，或 \`npx diffs local\`。数据目录：${diffsHome()}`,
          };
        }
      },
    },
    {
      name: "diff-last",
      description: "对比某个文件与上一版 git（默认 HEAD~1）",
      input: { hint: "<file> [revision]" },
      async handler({ rawInput, agent }) {
        const parts = rawInput.trim().split(/\s+/).filter(Boolean);
        if (parts.length < 1) return { kind: "error", text: "用法：/diff-last <file> [revision]" };
        const [file, revision = "HEAD~1"] = parts;
        try {
          const r = await compareFiles({ old: file, new: file, revision, cwd: agent?.cwd });
          return { kind: "success", text: `\`${file}\` vs ${revision}：${summarizeThin(r)}` };
        } catch (e) {
          return { kind: "error", text: e instanceof Error ? e.message : String(e) };
        }
      },
    },
  ];
}

/**
 * Package Config. The loader validates each row's `config` against this schema; a
 * package that declares no Config still accepts an explicit row config, but a row
 * that names fields needs the schema to describe them.
 */
export const Config = (() => {
  try {
    // Provided by the dsh installation at runtime; absent when the plugin is built or
    // tested standalone, in which case the row's config is accepted as-is.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Schema = require("@deepseek-ai/schemastery").default ?? require("@deepseek-ai/schemastery");
    return Schema.object({ localUrl: Schema.string(), tool: Schema.boolean(), commands: Schema.boolean() });
  } catch {
    return undefined;
  }
})();

/**
 * Services this plugin waits for. Declaring them makes the loader keep the
 * entry inactive until `tools` and `commands` exist.
 */
export const inject = ['tools', 'commands'];

/** Apply the plugin. Never throws: a broken tool must not block a DSH profile. */
export function apply(ctx: DshContext, config: DiffsConfig = {}): void {
  const resolved: Required<DiffsConfig> = {
    localUrl: config.localUrl || process.env.DIFFS_LOCAL_URL || DEFAULT_LOCAL_URL,
    tool: config.tool !== false,
    commands: config.commands !== false,
  };

  if (resolved.tool) {
    try {
      ctx.tools?.register(createDiffTool(ctx, resolved));
      ctx.logger?.info?.(`diffs: registered ${DIFF_TOOL_NAME}`);
    } catch (e) {
      ctx.logger?.warn?.(`diffs: could not register ${DIFF_TOOL_NAME} (${e instanceof Error ? e.message : String(e)})`);
    }
  }

  if (resolved.commands) {
    for (const command of createCommands(ctx, resolved)) {
      try {
        ctx.commands?.register(command);
      } catch (e) {
        ctx.logger?.warn?.(`diffs: could not register /${command.name} (${e instanceof Error ? e.message : String(e)})`);
      }
    }
  }
}