/**
 * diffs.work · DSH browser half — TypeScript source.
 *
 * Built to `lib/client.js` by `scripts/build-dsh-plugin.mjs`; the shipped artifact is a
 * plain IIFE because the host loads it through `window.__ModuleLoader__.load`, and a
 * module table is not a bundler: no imports may survive the build.
 *
 * Typed against the small surface that actually exists here (the module table's
 * `require`, the slot context, the tool payload). `types.ts` in this folder declares it.
 */
/**
 * diffs.work · DSH browser half.
 *
 * What a person sees, in three places:
 *
 *   1. `tool.call.toolview` keyed `diff_compare` — every comparison the agent
 *      makes renders as a diff card in the conversation: file pair, +/− counts,
 *      hunks with add/del/modify, and a link to the full local viewer.
 *   2. `sidebar.footer.action` — a "Changes" button that opens the pending list:
 *      every comparison of this session, newest first, each expandable, with
 *      "open in local viewer" per row.
 *   3. `conversation.composer.dock` — a one-line strip while the list is open:
 *      what the agent just compared, and whether the local viewer is running.
 *
 * Host half lives in `index.js` of the same package; it registers the
 * `diff_compare` tool and the `/diff-*` commands. The card only renders what the
 * tool already returned, so no extra request is made to draw it.
 *
 * Loaded through `window.__ModuleLoader__.load({ id, factory })`; React comes
 * from the module table, never bundled.
 */
import type { DiffPayload, DiffRecord, DiffRow, DiffHunk, ReactLike, SlotContext } from "./types";

;(function () {
  "use strict";

  var ID = "@diffs/dsh-plugin";
  /** Local viewer address, overridable from the plugin's settings row (`localUrl`). */
  var DEFAULT_LOCAL = "http://127.0.0.1:5279";

  /** Kind → label + colour, kept in one place so the card and the list agree. */
  var OP = {
    add: { label: "增", cls: "dsw-diffs-op-add", sign: "+" },
    del: { label: "删", cls: "dsw-diffs-op-del", sign: "-" },
    mod: { label: "改", cls: "dsw-diffs-op-mod", sign: "~" },
    move: { label: "移", cls: "dsw-diffs-op-move", sign: ">" },
  };

  /** Per-session comparison records, newest first. Capped so a long session stays light. */
  var MAX_RECORDS = 50;
  var state: { records: DiffRecord[]; listeners: Array<() => void>; open: boolean } = { records: [], listeners: [], open: false };

  function localBase(ctx: { get?(name: string): any } | null): string {
    try {
      var forms = ctx && ctx.get ? ctx.get("configForms") : null;
      var form = forms && forms.get ? forms.get(ID) : null;
      var value = form && form.getSnapshot ? form.getSnapshot().value : null;
      if (value && typeof value.localUrl === "string" && value.localUrl) return value.localUrl.replace(/\/$/, "");
    } catch (e) {
      /* config is optional */
    }
    return DEFAULT_LOCAL;
  }

  function notify() {
    var list = state.listeners.slice();
    for (var i = 0; i < list.length; i++) {
      try {
        list[i]();
      } catch (e) {
        /* a broken subscriber must not stop the rest */
      }
    }
  }

  function subscribe(fn: () => void): () => void {
    state.listeners.push(fn);
    return function () {
      var i = state.listeners.indexOf(fn);
      if (i >= 0) state.listeners.splice(i, 1);
    };
  }

  /** Add one record; de-duplicated by the tool call id so re-renders do not spam. */
  function record(entry: DiffRecord): void {
    for (var i = 0; i < state.records.length; i++) {
      if (state.records[i].id === entry.id) return;
    }
    state.records.unshift(entry);
    if (state.records.length > MAX_RECORDS) state.records.length = MAX_RECORDS;
    notify();
  }

  // ------------------------------------------------------------------ parsing

  /** Widen a row op into the four states the card draws. */
  function opOf(line: Partial<DiffRow> & { kind?: string }): DiffRow["op"] {
    var op = String(line.op || line.kind || "same");
    if (op === "add" || op === "insert" || op === "ins") return "add";
    if (op === "del" || op === "delete" || op === "remove") return "del";
    if (op === "mod" || op === "update" || op === "upd-del" || op === "upd-ins") return "mod";
    if (op === "move") return "move";
    return "same";
  }

  /** The tool result text is JSON (see the host half's render()); tolerate prose too. */
  /** The tool result, wherever this host puts it. Logged once per call in the console. */
  /**
   * Read a unified patch into the shape the card draws.
   *
   * The host hands the tool result back as `[{ type: "text", text: "--- a\n+++ b\n@@ ... @@ ..." }]`
   * — a patch, not JSON — so `parseResult` found no braces and the card said "两版内容一致" for a
   * pair that plainly differed. The patch is enough to draw every row.
   */
  function parseUnified(text: string): DiffPayload | null {
    var lines = String(text).split("\n");
    var first = -1;
    for (var i = 0; i < lines.length; i++) if (/^@@ /.test(lines[i])) { first = i; break; }
    if (first < 0) return null;
    var hunks: DiffHunk[] = [{ header: lines[first], lines: [] }];
    var cur = hunks[0];
    var oldNo = 0;
    var newNo = 0;
    var m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(lines[first]);
    if (m) { oldNo = parseInt(m[1], 10); newNo = parseInt(m[2], 10); }
    for (var j = first + 1; j < lines.length; j++) {
      var l = lines[j];
      if (/^@@ /.test(l)) {
        var mm = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
        if (mm) { oldNo = parseInt(mm[1], 10); newNo = parseInt(mm[2], 10); }
        cur = { header: l, lines: [] };
        hunks.push(cur);
        continue;
      }
      // `DiffRow` spells an insertion `add` and its line numbers `oldLine`/`newLine`. This parser
      // used the patch notation (`ins`, `oldNo`) instead, so an inserted line from a unified diff
      // was not counted and its line numbers never reached the gutter.
      if (l.charAt(0) === "+") { cur.lines.push({ op: "add", oldLine: null, newLine: newNo++, text: l.slice(1) }); }
      else if (l.charAt(0) === "-") { cur.lines.push({ op: "del", oldLine: oldNo++, newLine: null, text: l.slice(1) }); }
      else { cur.lines.push({ op: "same", oldLine: oldNo++, newLine: newNo++, text: l.charAt(0) === " " ? l.slice(1) : l }); }
    }
    var added = 0;
    var removed = 0;
    for (var k = 0; k < hunks.length; k++) {
      for (var n = 0; n < hunks[k].lines.length; n++) {
        var op = hunks[k].lines[n].op;
        if (op === "add") added++;
        else if (op === "del") removed++;
      }
    }
    return {
      hunks: hunks,
      added: added,
      removed: removed,
      summary: "+" + added + " / -" + removed,
      oldLabel: "",
      newLabel: "",
      family: "",
    } as unknown as DiffPayload;
  }

  function parseResult(block: any): DiffPayload | null {
    try {
    // A card payload written by this plugin's host half lives in the durable `tool/result` meta,
    // which is the only field a plugin can contribute to a shipped tool's card. Reading it FIRST is
    // what makes an `edit`, a `write` or a `bash` that touched a document draw a real diff instead
    // of nothing at all: the arguments of a shell command contain no diff to derive.
    var meta = block && block.meta;
    if (meta && typeof meta === "object") {
      if (meta.schema === "diffs.work/portable@1") {
        // A shell command can change several files; the card shows the first one and lists the rest.
        if (Array.isArray(meta.files) && meta.files.length > 0) {
          return meta.files[0] as DiffPayload;
        }
        if (Array.isArray(meta.hunks)) return meta as DiffPayload;
      }
    }
    // The host may hand the tool result over already parsed. Reading only `block.content` meant a
    // real diff rendered as "两版内容一致": the payload was there, this function could not see it.
    var direct = block && (block.result || block.value || block.structuredContent);
    if (direct && typeof direct === "object") {
      if (typeof direct.summary === "string" || Array.isArray(direct.hunks)) return direct as DiffPayload;
      if (direct.result && typeof direct.result === "object" && Array.isArray(direct.result.hunks)) {
        return direct.result as DiffPayload;
      }
    }
    var text = "";
    var content = block && block.content;
    if (typeof content === "string") text = content;
    else if (content && typeof content === "object" && typeof content.text === "string") text = content.text;
    else if (Array.isArray(content)) {
      for (var i = 0; i < content.length; i++) {
        var part = content[i];
        if (part && typeof part.text === "string") text += part.text;
      }
    }
    if (!text) return null;
    // The host concatenates every text part, so `text` is the patch *and* the JSON result. Take the
    // JSON when there is one — it carries the summary and the semantic rows — and fall back to the
    // patch only when there is not. Parsing both is what drew every row twice.
    // A portable@1 result starts with `{"schema"`; other payloads start with `{` and carry
    // `name`/`added`/`hunks`. Both are JSON, so try the first brace either way.
    var start = text.indexOf('{"schema"');
    if (start < 0) start = text.indexOf("{");
    if (start >= 0) {
      try {
        return JSON.parse(text.slice(start));
      } catch (e) {
        /* a truncated payload: keep going */
      }
    }
    return parseUnified(text);
    } catch (e) {
      // A payload this function cannot read must not take the conversation row down; the caller
      // falls back to the generic row.
      return null;
    }
  }

  /**
   * The call's arguments, from the shape the host actually passes.
   *
   * `tool.call.toolview` hands a view `{ phase, block }`, and the block carries a *lazy* `args`
   * getter — not `argsRaw`, which never existed here. Reading `argsRaw` returned null every time,
   * so every edit card rendered `+0 -0` and "两版内容一致": the plugin fired, and then had nothing
   * to draw with. Both spellings are tried so a change on either side does not go silent again.
   */
  function argsOf(block: any): Record<string, unknown> | null {
    try {
      if (!block) return null;
      var a = block.args;
      if (typeof a === "function") a = a();
      if (a && typeof a === "object") return a as Record<string, unknown>;
      if (typeof a === "string") return JSON.parse(a);
      var raw = block.argsRaw;
      if (typeof raw === "string") return JSON.parse(raw);
      if (raw && typeof raw === "object") return raw as Record<string, unknown>;
      var call = block.call;
      if (call) {
        var ca = call.args;
        if (typeof ca === "function") ca = ca();
        if (ca && typeof ca === "object") return ca as Record<string, unknown>;
        if (typeof ca === "string") return JSON.parse(ca);
      }
    } catch (e) {
      /* a card without arguments is better than a card that throws */
    }
    return null;
  }

  function baseName(p: unknown): string {
    if (typeof p !== "string" || !p) return "";
    var parts = p.split(/[\\/]/);
    return parts[parts.length - 1] || p;
  }

  /** Normalise a tool result into the shape every view here uses. */
  function toDiff(block: any): DiffRecord {
    var data = parseResult(block);
    var args = argsOf(block) || {};
    var oldPath = String(args.old || args.oldPath || "");
    var newPath = String(args.new || args.newPath || "");
    var name = baseName(newPath || oldPath) || "diff";
    if (!data) {
      return {
        id: (block && block.callId) || name,
        name: name,
        oldPath: oldPath,
        newPath: newPath,
        family: guessFamily(name),
        hunks: [],
        added: 0,
        removed: 0,
        summary: "",
        pending: true,
      };
    }
    // The host half may return rows (hunks), the semantic kernel output (semantic)
    // or the AST output (ast). Normalise all three into rows the card can draw.
    var rows: DiffRow[] = [];
    // A portable@1 result carries both `hunks` (line-level) and `semantic.hunks` (entity-level)
    // for the same change. Drawing both is why every row appeared twice; prefer the richer one.
    var hasSemantic = !!(data.semantic && Array.isArray((data.semantic as any).hunks)) || data.updates != null || data.moves != null;
    if (!hasSemantic && Array.isArray(data.hunks)) {
      for (var hi = 0; hi < data.hunks.length; hi++) {
        var hk = data.hunks[hi];
        var lines = hk.lines || [];
        for (var li = 0; li < lines.length; li++) {
          var ln = lines[li];
          rows.push({
            op: opOf(ln),
            oldLine: ln.oldLine == null ? ln.oldNo : ln.oldLine,
            newLine: ln.newLine == null ? ln.newNo : ln.newLine,
            text: ln.text || "",
            segments: ln.segments || null,
          });
        }
        rows.push({ op: "same", oldLine: null, newLine: null, text: "" });
      }
    }
    var semantic = data.semantic || (data.updates != null || data.moves != null) ? data : null;
    if (semantic && Array.isArray(semantic.hunks)) {
      for (var si = 0; si < semantic.hunks.length; si++) {
        var sh = semantic.hunks[si];
        var shLines = sh.lines || [];
        for (var sj = 0; sj < shLines.length; sj++) {
          var sl = shLines[sj];
          rows.push({
            op: opOf(sl),
            oldLine: sl.oldNo == null ? sl.oldLine : sl.oldNo,
            newLine: sl.newNo == null ? sl.newLine : sl.newNo,
            text: sl.text || "",
            segments: sl.segments || null,
          });
        }
        rows.push({ op: "same", oldLine: null, newLine: null, text: "" });
      }
    }
    var ast = data.ast || (data.before && data.after && data.after.hunks) ? data : null;
    if (ast && ast.after && Array.isArray(ast.after.hunks)) {
      for (var ai = 0; ai < ast.after.hunks.length; ai++) {
        var ah = ast.after.hunks[ai];
        var rg: { start_row?: number; start_column?: number; end_row?: number; end_column?: number } = ah.range || {};
        rows.push({
          op: opOf({ op: ah.operation as DiffRow["op"] }),
          oldLine: rg.start_row == null ? null : rg.start_row + 1,
          newLine: rg.start_row == null ? null : rg.start_row + 1,
          text:
            (rg.start_row === rg.end_row
              ? "→ 列 " + ((rg.start_column ?? 0) + 1) + "–" + (rg.end_column ?? 0) + "  "
              : "") + (ah.text || ""),
          node: true,
        });
      }
    }
    var hunks = [{ header: "", lines: rows }];
    return {
      id: (block && block.callId) || name + ":" + hunks.length,
      name: baseName(data.name || name),
      oldPath: data.oldPath || oldPath,
      newPath: data.newPath || newPath,
      family: data.family || guessFamily(name),
      hunks: hunks,
      // Count from the rows when the payload does not carry totals. `portable@1` puts `added` and
      // `removed` at the top level, but a tool result can arrive as hunks alone — and then the card
      // read `+0 -0` beside six real rows, which is what "两版内容一致" beside a changed file was.
      added: data.added || countOp(hunks, ["ins", "add"]),
      removed: data.removed || countOp(hunks, ["del", "delete"]),
      modified: data.updates || data.modified || 0,
      moved: data.moves || data.moved || 0,
      summary: data.summary || "",
      // The tool result carries the same comparison as OpenUI Lang; the card draws that when it
      // is present, so this surface and every other one render the same tree.
      openui: typeof data.openui === "string" ? data.openui : undefined,
      // The contract says `kind: "binary"`; reading `data.binary` made every docx/xlsx/pptx
      // card claim it had nothing to show, even when the result carried its revisions.
      binary: !!(data.binary || data.kind === "binary"),
      pending: false,
    };
  }

  function guessFamily(name: string): string {
    var ext = String(name).split(".").pop() ?? "";
    ext = ext.toLowerCase();
    if (["md", "markdown", "mdx"].indexOf(ext) >= 0) return "markdown";
    if (["xlsx", "xlsm", "docx", "pptx", "pdf"].indexOf(ext) >= 0) return ext;
    // Keep this list equal to the docs' language table: an extension missing here is rendered as
    // plain text, which for a Kotlin file looks like the tool does not support Kotlin at all.
    if (
      ("ts tsx mts cts js jsx mjs cjs py pyi pyw rs go java cs " +
        "c h cpp cc cxx hpp hh hxx kt kts scala swift lua rb php pl pm r dart " +
        "sh bash zsh sql vue toml yml yaml json css scss html htm xml").split(" ").indexOf(ext) >= 0
    ) return "code";
    return "text";
  }

  // ------------------------------------------------------------------- styles

  var CSS = [
    ".dsw-diffs-card{border:1px solid var(--dsw-border-color,rgba(127,127,127,.24));border-radius:10px;overflow:hidden;font-size:12px}",
    ".dsw-diffs-head{display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--dsw-fill-color-secondary,rgba(127,127,127,.08));cursor:pointer;user-select:none}",
    ".dsw-diffs-name{font-family:var(--dsw-font-family-mono,ui-monospace,monospace);font-size:12px;color:var(--dsw-text-color-primary,inherit)}",
    ".dsw-diffs-count{margin-left:auto;display:flex;gap:6px;align-items:center;color:var(--dsw-text-color-secondary,#888);font-variant-numeric:tabular-nums}",
    ".dsw-diffs-add{color:var(--dsw-color-success,#22c55e)}",
    ".dsw-diffs-mod{color:var(--dsw-color-warning,#f59e0b)}",
    ".dsw-diffs-move{color:#a78bfa}",
    ".dsw-diffs-del{color:var(--dsw-color-danger,#ef4444)}",
    ".dsw-diffs-body{border-top:1px solid var(--dsw-border-color,rgba(127,127,127,.24));max-height:min(70vh,560px);overflow:auto}",
    // Long runs of unchanged lines fold away, the way the site does it; a 300-line file should not
    // push the conversation off the screen.
    ".dsw-2p{display:grid;grid-template-columns:1fr 1fr;gap:0;font-family:var(--dsw-font-family-mono,ui-monospace,monospace)}",
    ".dsw-2p-col{min-width:0;border-right:1px solid var(--dsw-border-color,rgba(127,127,127,.18))}",
    ".dsw-2p-col:last-child{border-right:0}",
    ".dsw-2p-head{padding:2px 10px;color:var(--dsw-text-color-tertiary,#888);font-size:11px;border-bottom:1px solid var(--dsw-border-color,rgba(127,127,127,.18))}",
    ".dsw-2p-side{display:flex;gap:6px;padding:0 8px;white-space:pre-wrap;word-break:break-all}",
    ".dsw-2p-blank{background:var(--dsw-fill-color-secondary,rgba(127,127,127,.05))}",
    ".dsw-2p-side.add{background:color-mix(in srgb,var(--dsw-color-success,#22c55e) 12%,transparent)}",
    ".dsw-2p-side.del{background:color-mix(in srgb,var(--dsw-color-danger,#ef4444) 12%,transparent)}",
    ".dsw-2p-side.mod{background:color-mix(in srgb,var(--dsw-color-warning,#f59e0b) 14%,transparent)}",
    ".dsw-2p-txt{flex:1;min-width:0}",
    ".dsw-toggle{font:inherit;color:var(--dsw-text-color-secondary,#888);background:none;border:0;cursor:pointer;padding:2px 6px}",
    ".dsw-toggle:hover{color:var(--dsw-text-color-primary,inherit)}",
    ".dsw-fold{display:flex;align-items:center;gap:8px;padding:2px 10px;color:var(--dsw-text-color-tertiary,#888);background:var(--dsw-fill-color-secondary,rgba(127,127,127,.06));cursor:pointer;font-size:11px;user-select:none}",
    ".dsw-fold:hover{color:var(--dsw-text-color-primary,inherit)}",
    ".dsw-diffs-hunk{padding:2px 0;border-bottom:1px dashed var(--dsw-border-color,rgba(127,127,127,.18))}",
    ".dsw-diffs-hunk:last-child{border-bottom:0}",
    ".dsw-diffs-hunkhead{padding:2px 10px;color:var(--dsw-text-color-tertiary,#999);font-size:11px}",
    ".dsw-diffs-line{display:flex;gap:8px;padding:0 10px;font-family:var(--dsw-font-family-mono,ui-monospace,monospace);white-space:pre-wrap;word-break:break-all}",
    ".dsw-diffs-ln{width:34px;flex:none;text-align:right;color:var(--dsw-text-color-tertiary,#aaa)}",
    ".dsw-diffs-txt{flex:1;min-width:0;display:flex;gap:4px}",
    ".dsw-diffs-mark{flex:none;width:10px;color:var(--dsw-text-color-tertiary,#888);user-select:none}",
    ".dsw-seg-ins{background:color-mix(in srgb,var(--dsw-color-success,#22c55e) 32%,transparent);border-radius:2px}",
    ".dsw-seg-del{background:color-mix(in srgb,var(--dsw-color-danger,#ef4444) 32%,transparent);border-radius:2px;text-decoration:line-through}",
    ".dsw-seg-strong{font-weight:600}",
    ".dsw-diffs-line.add{background:color-mix(in srgb,var(--dsw-color-success,#22c55e) 10%,transparent)}",
    ".dsw-diffs-line.del{background:color-mix(in srgb,var(--dsw-color-danger,#ef4444) 10%,transparent)}",
    ".dsw-diffs-line.mod{background:color-mix(in srgb,var(--dsw-color-warning,#f59e0b) 12%,transparent)}",
    ".dsw-diffs-line.move{background:color-mix(in srgb,var(--dsw-color-info,#8b5cf6) 12%,transparent)}",
    ".dsw-diffs-foot{display:flex;gap:10px;align-items:center;padding:5px 10px;border-top:1px solid var(--dsw-border-color,rgba(127,127,127,.24));color:var(--dsw-text-color-secondary,#888)}",
    ".dsw-diffs-link{margin-left:auto;color:var(--dsw-color-primary,#3b82f6);cursor:pointer;text-decoration:none}",
    ".dsw-diffs-list{position:fixed;right:16px;bottom:64px;width:420px;max-height:min(70vh,620px);display:flex;flex-direction:column;background:var(--dsw-background-color-elevated,#fff);border:1px solid var(--dsw-border-color,rgba(127,127,127,.28));border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.18);z-index:60;overflow:hidden}",
    ".dsw-diffs-listhead{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--dsw-border-color,rgba(127,127,127,.24));font-weight:600}",
    ".dsw-diffs-close{margin-left:auto;cursor:pointer;color:var(--dsw-text-color-secondary,#888)}",
    ".dsw-diffs-items{overflow:auto;flex:1}",
    ".dsw-diffs-item{border-bottom:1px solid var(--dsw-border-color,rgba(127,127,127,.16))}",
    ".dsw-diffs-row{display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer}",
    ".dsw-oui-card{padding:8px 12px}",
    ".dsw-oui-title{font-weight:500;font-size:13px}",
    ".dsw-oui-sub{font-size:11.5px;opacity:.7;margin-bottom:6px}",
    ".dsw-oui-text{margin:0 0 4px;font-size:12.5px;line-height:1.6;white-space:pre-wrap}",
    ".dsw-oui-heading{font-weight:500;font-size:13px;margin:6px 0 4px}",
    ".dsw-oui-note{border:1px solid rgba(56,189,248,.4);background:rgba(56,189,248,.08);border-radius:4px;padding:4px 8px;font-size:12px;margin-bottom:4px}",
    ".dsw-oui-success{border-color:rgba(52,211,153,.4);background:rgba(52,211,153,.08)}",
    ".dsw-oui-table{width:100%;border-collapse:collapse;font-size:12px}",
    ".dsw-oui-table th{text-align:left;font-weight:400;opacity:.6;padding:4px 8px;border-bottom:1px solid rgba(255,255,255,.12)}",
    ".dsw-oui-table td{padding:4px 8px;border-bottom:1px solid rgba(255,255,255,.06);vertical-align:top}",
    ".dsw-oui-ins{color:#34d399}",
    ".dsw-oui-del{color:#f87171}",
    ".dsw-diffs-raw{white-space:pre-wrap;font-size:11.5px;padding:8px 12px}",
    ".dsw-diffs-row:hover{background:var(--dsw-fill-color-secondary,rgba(127,127,127,.08))}",
    ".dsw-diffs-empty{padding:20px 12px;text-align:center;color:var(--dsw-text-color-tertiary,#999)}",
    ".dsw-diffs-ops{display:flex;gap:4px;margin-left:auto;font-variant-numeric:tabular-nums}",
    ".dsw-diffs-dock{display:flex;align-items:center;gap:8px;padding:4px 10px;font-size:12px;color:var(--dsw-text-color-secondary,#888)}",
    ".dsw-diffs-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-color-success,#22c55e)}",
    ".dsw-diffs-dot.off{background:var(--dsw-text-color-tertiary,#bbb)}",
    ".dsw-diffs-btn{border:0;background:var(--dsw-fill-color-secondary,rgba(127,127,127,.12));color:inherit;border-radius:6px;padding:2px 8px;cursor:pointer;font-size:12px}",
  ].join("");

  function ensureStyle(doc: Document): HTMLStyleElement {
    var el = doc.createElement("style");
    el.setAttribute("data-plugin", ID);
    el.textContent = CSS;
    doc.head.appendChild(el);
    return el;
  }

  // ------------------------------------------------------------------- render

  /**
   * OpenUI Lang v0.1, the subset a comparison produces.
   *
   * Duplicated from packages/diff-ui on purpose: the client bundle shares React with the host, so
   * importing that package would ship a second React. This is ~60 lines of pure functions.
   */
  /**
   * One line of a comparison as the card draws it.
   *
   * The renderer works with a normalised line rather than the wire shape: an
   * operation, the two line numbers, its text, and — for a changed row — the
   * word-level segments the kernel produced.
   */
  interface DiffLine {
    op: string;
    oldLine?: number | null;
    newLine?: number | null;
    text?: string;
    segments?: Array<{ op: string; text: string }> | null;
  }

  /**
   * One parsed OpenUI statement.
   *
   * The shape the small parser below builds: the component name, its props,
   * its child nodes, and either `items` (an array argument) or `value` (a
   * scalar one).
   */
  interface OuiNode {
    type: string;
    props: Record<string, unknown>;
    children: OuiNode[];
    items?: unknown[];
    value?: string;
  }

  function splitTop(src: string): string[] {
    var out: string[] = [], depth = 0, quote = null, cur = "";
    for (var i = 0; i < src.length; i++) {
      var ch = src[i];
      if (quote) { cur += ch; if (ch === quote && src[i - 1] !== "\\") quote = null; continue; }
      if (ch === '"' || ch === "'") { quote = ch; cur += ch; }
      else if ("[({".indexOf(ch) >= 0) { depth++; cur += ch; }
      else if ("])}".indexOf(ch) >= 0) { depth--; cur += ch; }
      else if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  function ouiLiteral(src: string, vars: Record<string, unknown>): unknown {
    var t = src.trim();
    if (t.length > 1 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]) {
      try { return JSON.parse(t[0] === '"' ? t : '"' + t.slice(1, -1).replace(/"/g, '\\"') + '"'); }
      catch (e) { return t.slice(1, -1); }
    }
    if (t === "true") return true;
    if (t === "false") return false;
    if (t === "null") return null;
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    if (t[0] === "[" && t[t.length - 1] === "]") {
      return splitTop(t.slice(1, -1)).map(function (x) { return ouiLiteral(x, vars); });
    }
    if (t[0] === "{" && t[t.length - 1] === "}") {
      var props: Record<string, unknown> = {};
      splitTop(t.slice(1, -1)).forEach(function (pair) {
        var i = pair.indexOf(":");
        if (i < 0) return;
        props[pair.slice(0, i).trim().replace(/^["']|["']$/g, "")] = ouiLiteral(pair.slice(i + 1), vars);
      });
      return props;
    }
    if (vars[t]) return vars[t];
    var m = /^([A-Z][A-Za-z]*)\(([\s\S]*)\)$/.exec(t);
    if (m) return ouiCall(m[1], m[2], vars);
    return t;
  }

  function ouiCall(name: string, argsSrc: string, vars: Record<string, unknown>): OuiNode {
    var node: OuiNode = { type: name, props: {}, children: [] };
    splitTop(argsSrc).map(function (a) { return ouiLiteral(a, vars); }).forEach(function (a) {
      if (Array.isArray(a)) {
        if (a.length && a.every(function (x) { return x && typeof x === "object" && "type" in x; })) {
          node.children = node.children.concat(a as OuiNode[]);
        } else node.items = a as unknown[];
      } else if (a && typeof a === "object") {
        for (var k in a as Record<string, unknown>) node.props[k] = (a as Record<string, unknown>)[k];
      } else if (typeof a === "string") node.value = a;
    });
    return node;
  }

  function ouiStatements(src: string): string[] {
    var out: string[] = [], depth = 0, quote: string | null = null, cur = "";
    for (var i = 0; i < src.length; i++) {
      var ch = src[i];
      if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'") quote = ch;
      else if ("[({".indexOf(ch) >= 0) depth++;
      else if (")]}".indexOf(ch) >= 0) depth--;
      if (ch === "\n" && depth === 0) { if (cur.trim()) out.push(cur); cur = ""; continue; }
      cur += ch;
    }
    if (cur.trim()) out.push(cur);
    return out;
  }

  /** Parse OpenUI Lang source into a node tree; throws when there is no card. */
  function parseOpenUI(src: string): OuiNode {
    var vars: Record<string, OuiNode> = {}, last: OuiNode | null = null;
    ouiStatements(String(src)).forEach(function (raw) {
      var m = /^\s*([A-Za-z_]\w*)\s*=\s*([A-Z][A-Za-z]*)\(([\s\S]*)\)\s*;?\s*$/.exec(raw);
      if (!m) return;
      var node = ouiCall(m[2], m[3], vars);
      vars[m[1]] = node;
      last = node;
    });
    if (vars.root) return vars.root;
    if (!last) throw new Error("openui: no card");
    return last;
  }

  /** How many rows of these ops the hunks contain. */
  function countOp(hunks: any[], ops: string[]): number {
    var n = 0;
    for (var i = 0; i < (hunks || []).length; i++) {
      var lines = (hunks[i] && hunks[i].lines) || [];
      for (var j = 0; j < lines.length; j++) {
        var op = lines[j] && (lines[j].op || lines[j].kind);
        if (ops.indexOf(String(op)) >= 0) n += 1;
      }
    }
    return n;
  }

  /** Filled in by `register`, where the card components live; read through `__internals`. */
  var internals: { render?: (d: any) => any } = {};

  function register(React: ReactLike, ctx: SlotContext): void {
    var h = React.createElement;

    /**
     * Draw the OpenUI tree a comparison was described as.
     *
     * The card had been reading `diff.openui` and rendering through a function that no longer
     * existed — a reference the bundler accepted and the runtime did not. The whole card vanished,
     * which is what "参考组件错误" looks like from the outside: the throw blanks the slot entry.
     */
    function OpenUICard(props: { source: string }): unknown {
      var tree: any;
      try {
        tree = parseOpenUI(props.source);
      } catch (e) {
        return h("pre", { className: "dsw-diffs-raw" }, props.source);
      }
      function node(n: any, key: any): unknown {
        try {
          return nodeInner(n, key);
        } catch (e) {
          return h("div", { key: key, className: "dsw-oui-unknown" }, "oui error: " + String(e).slice(0, 150));
        }
      }
      function nodeInner(n: any, key: any): unknown {
        if (!n) return null;
        var kids = (n.children || []).map(function (c: any, i: number) { return node(c, i); });
        if (n.type === "Card") {
          return h("div", { key: key, className: "dsw-oui-card" },
            n.props.title ? h("div", { className: "dsw-oui-title" }, String(n.props.title)) : null,
            n.props.subtitle ? h("div", { className: "dsw-oui-sub" }, String(n.props.subtitle)) : null,
            kids);
        }
        if (n.type === "Text") return h("p", { key: key, className: "dsw-oui-text" }, String(n.value || ""));
        if (n.type === "Heading") return h("div", { key: key, className: "dsw-oui-heading" }, String(n.value || ""));
        if (n.type === "Note") {
          return h("div", { key: key, className: "dsw-oui-note dsw-oui-" + String(n.props.tone || "info") }, String(n.value || ""));
        }
        if (n.type === "Divider") return h("hr", { key: key, className: "dsw-oui-hr" });
        if (n.type === "Badge") return h("span", { key: key, className: "dsw-oui-badge" }, String(n.value || ""));
        if (n.type === "Table") {
          var cols = Array.isArray(n.props.columns) ? n.props.columns : [];
          var rows = Array.isArray(n.items) ? n.items : [];
          return h("table", { key: key, className: "dsw-oui-table" },
            cols.length ? h("thead", null, h("tr", null, cols.map(function (c: any, i: number) { return h("th", { key: i }, String(c)); }))) : null,
            h("tbody", null, rows.map(function (r: any, i: number) {
              var cells = Array.isArray(r) ? r : [r];
              return h("tr", { key: i }, cells.map(function (cell: any, j: number) {
                var s = String(cell);
                var cls = s === "新增" ? "dsw-oui-ins" : s === "删除" ? "dsw-oui-del" : "";
                return h("td", { key: j, className: cls }, s);
              }));
            })));
        }
        if (kids.length) return h("div", { key: key }, kids);
        return h("div", { key: key, className: "dsw-oui-unknown" }, "[" + n.type + "]");
      }
      return node(tree, "root");
    }


    /**
     * Collapse long runs of unchanged rows.
     *
     * Returns the rows to draw, where a long `same` run becomes one fold marker that expands on
     * click. Without this a 300-line file pushes the rest of the conversation off the screen, which
     * is the difference the reader noticed between this card and the site.
     */
    function FoldedLines(props: { lines: DiffLine[]; hunkKey: string; draw: (l: DiffLine, i: number) => unknown }): unknown {
      var FOLD_AFTER = 3;
      var [openAll, setOpenAll] = React.useState<Record<string, boolean>>({});
      var lines = props.lines || [];
      var out: unknown[] = [];
      var i = 0;
      while (i < lines.length) {
        var op: string = (lines[i] as any).op || (lines[i] as any).kind || "same";
        if (op !== "same") {
          out.push(props.draw(lines[i], i));
          i += 1;
          continue;
        }
        var j = i;
        while (j < lines.length && (((lines[j] as any).op || (lines[j] as any).kind || "same") === "same")) j += 1;
        var run = j - i;
        var key = props.hunkKey + ":" + i;
        if (run <= FOLD_AFTER * 2 || openAll[key]) {
          for (var k = i; k < j; k++) out.push(props.draw(lines[k], k));
        } else {
          for (var a = i; a < i + FOLD_AFTER; a++) out.push(props.draw(lines[a], a));
          out.push(
            h(
              "div",
              {
                key: "fold" + i,
                className: "dsw-fold",
                onClick: function (kk: string) { return function () { setOpenAll(Object.assign({}, openAll, { [kk]: true })); }; }(key),
              },
              "⋯ 展开 " + (run - FOLD_AFTER * 2) + " 行未改动",
            ),
          );
          for (var b = j - FOLD_AFTER; b < j; b++) out.push(props.draw(lines[b], b));
        }
        i = j;
      }
      return h("div", null, out);
    }

    /**
     * The side-by-side view: old on the left, new on the right, a row per paired line.
     *
     * The card had been one column with two line numbers, which is a unified diff — readable, but
     * not what the site shows, and the reason it read as "a plain code block" beside it. A deleted
     * row exists only on the left and an added row only on the right; unchanged rows appear on both.
     */
    function buildRows(lines: DiffLine[]): Array<{ left?: DiffLine; right?: DiffLine }> {
      var out: Array<{ left?: DiffLine; right?: DiffLine }> = [];
      var pending: DiffLine[] = [];
      for (var i = 0; i < lines.length; i++) {
        var ln: any = lines[i];
        var op: string = ln.op || ln.kind || "same";
        if (op === "same") {
          for (var p = 0; p < pending.length; p++) out.push({ left: pending[p] });
          pending = [];
          out.push({ left: ln, right: ln });
        } else if (op === "mod" || op === "update") {
          // An update is one row present on both sides, not a deletion plus an insertion: `side()`
          // splits its `old → new` text per column.
          for (var pm = 0; pm < pending.length; pm++) out.push({ left: pending[pm] });
          pending = [];
          out.push({ left: ln, right: ln });
        } else if (op === "del") {
          pending.push(ln);
        } else {
          var partner = pending.shift();
          out.push({ left: partner, right: ln });
        }
      }
      for (var q = 0; q < pending.length; q++) out.push({ left: pending[q] });
      return out;
    }

    function TwoPane(props: { hunks?: DiffHunk[]; binary?: boolean }): unknown {
      var hunks = props.hunks || [];
      var lines: DiffLine[] = [];
      for (var hh = 0; hh < hunks.length; hh++) lines = lines.concat(hunks[hh].lines || []);
      if (!lines.length) {
        return h("div", { className: "dsw-diffs-empty" }, props.binary ? "二进制文件：在本地视图中查看" : "两版内容一致");
      }
      // Each hunk is paired on its own: a deletion in one hunk must not be paired with an insertion
      // in the next, which is what concatenating first would do.
      var rows: Array<{ left?: DiffLine; right?: DiffLine; gap?: boolean; header?: string }> = [];
      for (var hi2 = 0; hi2 < hunks.length; hi2++) {
        // A separator that names the hunk: in a long file, a bare ⋯ says nothing about where you
        // are, and the unified view shows the @@ header there.
        if (hi2 > 0) rows.push({ gap: true, header: hunks[hi2].header || "@@ hunk " + (hi2 + 1) + " @@" });
        var part = buildRows(hunks[hi2].lines || []);
        for (var pi = 0; pi < part.length; pi++) rows.push(part[pi]);
      }
      function side(line: DiffLine | undefined, which: "old" | "new"): unknown {
        if (!line) return h("div", { className: "dsw-2p-side dsw-2p-blank" });
        var op: string = (line as any).op || (line as any).kind || "same";
        var no = which === "old" ? (line as any).oldLine : (line as any).newLine;
        // A deleted row is old-side only, an inserted row new-side only; the other side is blank.
        if (op === "del" && which === "new") return h("div", { className: "dsw-2p-side dsw-2p-blank" });
        if ((op === "ins" || op === "add") && which === "old") return h("div", { className: "dsw-2p-side dsw-2p-blank" });
        var cls = op === "add" || op === "ins" ? "add" : op === "del" ? "del" : op === "mod" ? "mod" : op === "move" ? "move" : "";
        // An update row carries one sentence, `old → new`, because in a unified view that is the
        // most useful form. Side by side it has to be split, or the same combined text appears in
        // both columns and neither side says what that side actually contains.
        var text = String((line as any).text || "");
        if (op === "mod" || op === "update") {
          var arrow = text.indexOf(" → ");
          if (arrow > 0) text = which === "old" ? text.slice(0, arrow) : text.slice(arrow + 3);
        }
        return h(
          "div",
          { className: "dsw-2p-side " + cls },
          h("span", { className: "dsw-diffs-ln" }, no == null ? "" : String(no)),
          h("span", { className: "dsw-2p-txt" }, text),
        );
      }
      return h(
        "div",
        { className: "dsw-2p" },
        h("div", { className: "dsw-2p-col" },
          h("div", { className: "dsw-2p-head" }, "旧版"),
          rows.map(function (r, i) { return r.gap ? h("div", { key: "lg" + i, className: "dsw-2p-head" }, "⋯ " + String(r.header || "")) : h("div", { key: "l" + i, className: "dsw-2p-row-l" }, side(r.left, "old")); })),
        h("div", { className: "dsw-2p-col" },
          h("div", { className: "dsw-2p-head" }, "新版"),
          rows.map(function (r, i) { return r.gap ? h("div", { key: "rg" + i, className: "dsw-2p-head" }, " ") : h("div", { key: "r" + i, className: "dsw-2p-row-r" }, side(r.right, "new")); })),
      );
    }

    function Hunks(props: { hunks?: DiffHunk[]; binary?: boolean }): unknown {
      var hunks = props.hunks || [];
      if (!hunks.length) {
        return h("div", { className: "dsw-diffs-empty" }, props.binary ? "二进制文件：在本地视图中查看" : "两版内容一致");
      }
      return h(
        "div",
        null,
        hunks.map(function (hunk, hi) {
          return h(
            "div",
            { key: "h" + hi, className: "dsw-diffs-hunk" },
            h("div", { className: "dsw-diffs-hunkhead" }, hunk.header || "@@ hunk " + (hi + 1) + " @@"),
            h(FoldedLines, {
              hunkKey: "h" + hi,
              lines: hunk.lines || [],
              draw: function (line: any, li: number) {
                var op: string = line.op || line.kind || "same";
                var cls = op === "add" || op === "ins" ? "add" : op === "del" ? "del" : op === "mod" ? "mod" : op === "move" ? "move" : "";
                // Character-level segments when the engine supplied them: the site tints only the
                // characters that moved, and a card that tints the whole line reads as "this line
                // changed" rather than "these three characters did".
                // The engine calls them `segments` on one path and `inline` on another; both are the
                // same character-level split, and reading only one is why the tint never appeared.
                var segs = Array.isArray((line as any).inline)
                  ? (line as any).inline
                  : Array.isArray((line as any).segments)
                    ? (line as any).segments
                    : null;
                var body: unknown = h(
                  "span",
                  { className: "dsw-diffs-mark" },
                  cls === "add" ? "+" : cls === "del" ? "-" : cls === "move" ? "~" : " ",
                );
                var textPart: unknown = segs && segs.length
                  ? h(
                      "span",
                      null,
                      segs.map(function (seg: any, si: number) {
                        var sc = seg.op === "insert" ? "dsw-seg-ins" : seg.op === "delete" ? "dsw-seg-del" : "";
                        if (seg.mark === "strong") sc += " dsw-seg-strong";
                        return h("span", { key: si, className: sc }, String(seg.text == null ? "" : seg.text));
                      }),
                    )
                  : (line.text || "");
                return h(
                  "div",
                  { key: "l" + li, className: "dsw-diffs-line " + cls },
                  h("span", { className: "dsw-diffs-ln" }, line.oldLine == null ? "" : String(line.oldLine)),
                  h("span", { className: "dsw-diffs-ln" }, line.newLine == null ? "" : String(line.newLine)),
                  h("span", { className: "dsw-diffs-txt" }, body, textPart),
                );
              },
            }),
          );
        }),
      );
    }

    // the host passes the tool call block; only these parts are read
    /**
     * An `edit` / `write` / `apply_patch` result, drawn as a diff.
     *
     * These tools do not return diff JSON: they return a line or two of prose ("Edited
     * /path/app.js, +1 -1"). What they *do* carry is the arguments — the path, plus `old_string`
     * and `new_string` for an edit, or `content` for a write — which is enough for the row that
     * matters: which file, and which characters moved.
     */
    /**
     * An `edit` / `write` / `apply_patch` row, drawn with the same card the comparison uses.
     *
     * These tools do not return diff JSON — they return a line of prose. What they carry is the
     * call arguments (`file_path`, `old_string`, `new_string`), which is enough to build the same
     * `DiffRecord` the comparison card already knows how to draw, so there is one renderer.
     */
    function EditCard(props: { block?: any; callId?: string }): unknown {
      var block = (props && props.block) || {};
      var args = argsOf(block) || {};
      var file = String(args.path || args.file_path || args.filePath || args.file || "");
      var oldStr = args.old_string != null ? String(args.old_string) : args.oldString != null ? String(args.oldString) : null;
      var newStr = args.new_string != null ? String(args.new_string) : args.newString != null ? String(args.newString) : null;
      var whole = typeof args.content === "string" ? args.content : null;

      var rows: DiffRow[] = [];
      var added = 0;
      var removed = 0;
      if (oldStr != null || newStr != null) {
        var oldLines = String(oldStr || "").split("\n");
        var newLines = String(newStr || "").split("\n");
        for (var i = 0; i < oldLines.length || i < newLines.length; i++) {
          var a = oldLines[i];
          var b = newLines[i];
          if (a === b) {
            if (a != null) rows.push({ op: "same", oldLine: i + 1, newLine: i + 1, text: a });
            continue;
          }
          if (a != null) { rows.push({ op: "del", oldLine: i + 1, newLine: null, text: a }); removed++; }
          if (b != null) { rows.push({ op: "add", oldLine: null, newLine: i + 1, text: b }); added++; }
        }
      } else if (whole != null) {
        var wl = whole.split("\n");
        for (var w = 0; w < Math.min(wl.length, 20); w++) rows.push({ op: "same", oldLine: w + 1, newLine: w + 1, text: wl[w] });
      }

      var record = {
        id: String((props && props.callId) || file || "edit"),
        name: baseName(file) || "edit",
        oldPath: file,
        newPath: file,
        family: guessFamily(file),
        hunks: rows.length ? [{ header: "@@ " + baseName(file) + " @@", lines: rows }] : [],
        rows: rows,
        added: added,
        removed: removed,
        summary: rows.length ? "+" + added + " / -" + removed : "",
        pending: false,
      };
      return h(DiffCard, { block: undefined, callId: record.id, record: record } as never);
    }

    function DiffCard(props: { block?: Parameters<typeof toDiff>[0]; callId?: string; argsRaw?: string; content?: unknown; record?: DiffRecord }): unknown {
      // The host calls a tool view with an empty props object once before handing it the real
      // ones. Reading `props.block` unconditionally threw there, and the failure took the real
      // render with it — which is why the card never appeared while the component was clearly
      // being mounted.
      var empty = !props || (!props.block && !props.record && !props.callId);
      var [open, setOpen] = React.useState(true);
      // Side by side by default, matching the site; unified is one click away for a narrow panel.
      var [split, setSplit] = React.useState(true);
      var diff: DiffRecord;
      try {
        diff = React.useMemo(
          function () {
            // `record` lets the edit card reuse this renderer with rows it already built.
            return props.record ? props.record : toDiff(props.block);
          },
          [props.block, props.record],
        );
      } catch (e) {
        // A malformed payload must not take the whole conversation row down.
        return h("div", { className: "dsw-diffs-empty" }, "diff payload unreadable: " + String(e).slice(0, 120));
      }
      // A rendered card is also a record: the pending list must see it.
      React.useEffect(
        function () {
          if (!diff.pending) record(diff);
        },
        [diff.id, diff.pending],
      );
      // The host renders this component once with an empty props object. Returning early *before*
      // the hooks above would give that render a different hook count than the real one, and React
      // unmounts the subtree instead of drawing it — the card was never broken, it was discarded.
      if (empty) return null;
      var base = localBase(ctx);
      var link = base + "/#/compare";
      return h(
        "div",
        { className: "dsw-diffs-card", "data-testid": "diffs-card" },
        h(
          "div",
          { className: "dsw-diffs-head", onClick: function () { setOpen(!open); } },
          h("span", null, open ? "▾" : "▸"),
          h("span", { className: "dsw-diffs-name" }, diff.name),
          h("button", {
            className: "dsw-toggle",
            onClick: function (e: any) { if (e && e.stopPropagation) e.stopPropagation(); setSplit(!split); },
          }, split ? "单栏" : "并排"),
          h("span", { className: "dsw-diffs-count" },
            h("span", { className: "dsw-diffs-add" }, "+" + diff.added),
            h("span", { className: "dsw-diffs-del" }, "-" + diff.removed),
            diff.modified ? h("span", { className: "dsw-diffs-mod" }, "~" + diff.modified) : null,
            diff.moved ? h("span", { className: "dsw-diffs-move" }, ">" + diff.moved) : null,
          ),
        ),
        open
          ? h("div", { className: "dsw-diffs-body" },
              // Draw the OpenUI tree the tool produced, so this surface and every other one are
              // showing the same description rather than two renderers that can drift.
              // `Hunks` first, `openui` as the fallback — not the other way round.
              //
              // `toOpenUI()` describes a comparison as Card + Text + Table(行号|类型|内容), which is
              // the right shape for a surface with nothing better. This one has better: `Hunks`
              // draws the two line-number columns, the +/- marker and the add/del/mod/move colours
              // the site uses. Rendering the table here is what made the desktop card look like a
              // plain code block beside the website.
              diff.hunks && diff.hunks.length && split
                ? h(TwoPane, { hunks: diff.hunks, binary: diff.binary })
                : diff.hunks && diff.hunks.length
                ? h(Hunks, { hunks: diff.hunks, binary: diff.binary })
                : diff.openui
                  ? h(OpenUICard, { source: diff.openui })
                  : h(Hunks, { hunks: [], binary: diff.binary }))
          : null,
        h(
          "div",
          { className: "dsw-diffs-foot" },
          h("span", null, diff.summary || (diff.pending ? "对比中…" : "")),
          h("a", { className: "dsw-diffs-link", href: link, target: "_blank", rel: "noreferrer" }, "在本地视图中打开 ↗"),
        ),
      );
    }

    // A headless way to draw the card, for tests: rendering the tree is how "the counts say +0 -0
    // beside six real rows" should have been caught before it reached a reader.
    internals.render = function (d: any) {
      return DiffCard({ block: undefined, callId: d.id, record: d } as never);
    };

    function PendingList() {
      var [, force] = React.useState(0);
      React.useEffect(function () { return subscribe(function () { force(function (n) { return n + 1; }); }); }, []);
      var [expanded, setExpanded] = React.useState("");
      var base = localBase(ctx);
      if (!state.open) return null;
      return h(
        "div",
        { className: "dsw-diffs-list", "data-testid": "diffs-pending" },
        h(
          "div",
          { className: "dsw-diffs-listhead" },
          h("span", null, "待处理对比"),
          h("span", { className: "dsw-diffs-count" }, String(state.records.length)),
          h("span", { className: "dsw-diffs-close", onClick: function () { state.open = false; notify(); } }, "✕"),
        ),
        h(
          "div",
          { className: "dsw-diffs-items" },
          state.records.length
            ? state.records.map(function (r) {
                var isOpen = expanded === r.id;
                return h(
                  "div",
                  { key: r.id, className: "dsw-diffs-item" },
                  h(
                    "div",
                    { className: "dsw-diffs-row", onClick: function () { setExpanded(isOpen ? "" : r.id); } },
                    h("span", { className: "dsw-diffs-name" }, r.name),
                    h("span", { className: "dsw-diffs-ops" },
                      h("span", { className: "dsw-diffs-add" }, "+" + r.added),
                      h("span", { className: "dsw-diffs-del" }, "-" + r.removed),
                    ),
                  ),
                  isOpen
                    ? h("div", null,
                        h("div", { className: "dsw-diffs-body" }, h(Hunks, { hunks: r.hunks, binary: r.binary })),
                        h("div", { className: "dsw-diffs-foot" },
                          h("a", { className: "dsw-diffs-link", href: base + "/#/compare", target: "_blank", rel: "noreferrer" }, "在本地视图中打开 ↗"),
                        ),
                      )
                    : null,
                );
              })
            : h("div", { className: "dsw-diffs-empty" }, "本会话还没有对比记录。让 agent 调 diff_compare 即可。"),
        ),
      );
    }

    /** Sidebar foot button: opens the pending list. */
    function ChangesButton() {
      var [, force] = React.useState(0);
      React.useEffect(function () { return subscribe(function () { force(function (n) { return n + 1; }); }); }, []);
      return h(
        "button",
        {
          type: "button",
          className: "dsw-diffs-btn",
          title: "diffs.work · 对比记录",
          onClick: function () { state.open = !state.open; notify(); },
        },
        "对比 " + state.records.length,
      );
    }

    /** Composer dock strip: the latest comparison and the viewer's reachability. */
    function DockStrip() {
      var [alive, setAlive] = React.useState(false);
      var [, force] = React.useState(0);
      React.useEffect(function () { return subscribe(function () { force(function (n) { return n + 1; }); }); }, []);
      React.useEffect(
        function () {
          var stopped = false;
          fetch(localBase(ctx) + "/api/health", { mode: "cors" })
            .then(function (r) { return r.ok; })
            .catch(function () { return false; })
            .then(function (ok) { if (!stopped) setAlive(!!ok); });
          return function () { stopped = true; };
        },
        [],
      );
      var latest = state.records[0];
      return h(
        "div",
        { className: "dsw-diffs-dock", "data-testid": "diffs-dock" },
        h("span", { className: "dsw-diffs-dot" + (alive ? "" : " off") }),
        h("span", null, alive ? "本地视图在线" : "本地视图未运行（diffs local）"),
        latest ? h("span", null, "· 最近：" + latest.name + " +" + latest.added + " -" + latest.removed) : null,
        h("button", { type: "button", className: "dsw-diffs-btn", onClick: function () { state.open = !state.open; notify(); } }, "对比记录"),
      );
    }

    ctx.slots.inject("tool.call.toolview", function () {
      var out: Array<() => void> = [];
      out.push(ctx.slots.register({ name: "tool.call.toolview", key: "diff_compare", priority: -1 }, DiffCard) as () => void);
      // Every other tool that changes a file renders through the same card. Installing a diff
      // plugin should change how edits look; before this, an `edit` still drew the host's own row
      // and the person had to ask for `diff_compare` on top of it.
      // `bash` is here because that is how a document is actually edited: an agent driving
      // `python-docx` never calls `edit`. The card reads the payload the host half wrote into the
      // result's meta and falls back to the host's own row when there is none.
      var editKeys = ["edit", "write", "apply_patch", "multi_edit", "str_replace", "bash"];
      for (var i = 0; i < editKeys.length; i++) {
        out.push(ctx.slots.register({ name: "tool.call.toolview", key: editKeys[i], priority: -1 }, EditCard) as () => void);
      }
      return function () { for (var j = 0; j < out.length; j++) out[j](); };
    });
    ctx.slots.inject("sidebar.footer.action", function () {
      return ctx.slots.register({ name: "sidebar.footer.action", id: "diffs-changes", order: 5, label: "对比" }, ChangesButton);
    });
    ctx.slots.inject("shell.overlay", function () {
      return ctx.slots.register({ name: "shell.overlay", id: "diffs-pending", order: 40 }, PendingList);
    });
    ctx.slots.inject("conversation.composer.dock", function () {
      return ctx.slots.register({ name: "conversation.composer.dock", id: "diffs-dock", order: 30 }, DockStrip);
    });
  }

  window.__ModuleLoader__.load({
    id: ID,
    factory: function (require) {
      var React = require("react");
      return {
        name: ID,
        inject: ["slots"],
        apply: function (ctx: SlotContext) {
          var doc = typeof document !== "undefined" ? document : null;
          if (doc && typeof ctx.effect === "function") {
            ctx.effect(function () {
              var tag = ensureStyle(doc as Document);
              return function () {
                if (tag.parentNode) tag.parentNode.removeChild(tag);
              };
            });
          }
          register(React as ReactLike, ctx);
        },
        // exposed for the host half's tests and for debugging in the console
        // a getter: `register` runs after this object is built, so capturing the value would hand
        // the tests `undefined`
        __internals: {
          toDiff: toDiff,
          state: state,
          OP: OP,
          get render() {
            return internals.render;
          },
        },
      };
    },
  });
})();