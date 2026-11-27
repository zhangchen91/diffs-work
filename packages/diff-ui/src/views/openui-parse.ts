/**
 * Parse OpenUI Lang v0.1.
 *
 * No React and no host dependency: the DSH renderer, a test, and any future adapter all read the
 * same tree from here. Grammar: one assignment per line, `name = Call(args...)`.
 */

export interface OpenUINode {
  type: string;
  props: Record<string, unknown>;
  children: OpenUINode[];
  items?: unknown[];
  value?: unknown;
}

/** Split `a, [b, c], { d: 1 }` at the top level only. */
function splitTop(src: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      cur += ch;
      if (ch === quote && src[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if ("[({".includes(ch)) {
      depth += 1;
      cur += ch;
    } else if ("])}".includes(ch)) {
      depth -= 1;
      cur += ch;
    } else if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function literal(src: string, vars: Record<string, OpenUINode>): unknown {
  const t = src.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return JSON.parse(t.startsWith("'") ? '"' + t.slice(1, -1).replace(/"/g, '\\"') + '"' : t);
  }
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t.startsWith("[") && t.endsWith("]")) return splitTop(t.slice(1, -1)).map((x) => literal(x, vars));
  if (t.startsWith("{") && t.endsWith("}")) {
    const props: Record<string, unknown> = {};
    for (const pair of splitTop(t.slice(1, -1))) {
      const i = pair.indexOf(":");
      if (i < 0) continue;
      const k = pair.slice(0, i).trim().replace(/^["']|["']$/g, "");
      props[k] = literal(pair.slice(i + 1), vars);
    }
    return props;
  }
  if (vars[t]) return vars[t];
  const m = /^([A-Z][A-Za-z]*)\s*\(([\s\S]*)\)$/.exec(t);
  if (m) return call(m[1], m[2], vars);
  return t;
}

function call(name: string, argsSrc: string, vars: Record<string, OpenUINode>): OpenUINode {
  const args = splitTop(argsSrc).map((a) => literal(a, vars));
  const node: OpenUINode = { type: name, props: {}, children: [] };
  for (const a of args) {
    if (Array.isArray(a)) {
      // an array of nodes is the children; an array of strings is Table rows
      if (a.every((x) => typeof x === "object" && x && (x as OpenUINode).type)) {
        node.children.push(...(a as OpenUINode[]));
      } else node.items = a;
    } else if (a && typeof a === "object") {
      node.props = { ...node.props, ...(a as Record<string, unknown>) };
    } else if (typeof a === "string") {
      node.value = a;
    }
  }
  return node;
}

/** Parse OpenUI Lang source. Unknown syntax throws — the caller shows the plain text instead. */
/**
 * Join continuation lines: an assignment can span lines when its parentheses stay open, which is
 * how a Table with several rows arrives. Splitting on newlines first threw those away.
 */
function statementsOf(src: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (const ch of src) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if ("([{".includes(ch)) depth += 1;
    else if (")]}".includes(ch)) depth -= 1;
    if (ch === "\n" && depth === 0) {
      if (cur.trim()) out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

export function parseOpenUI(src: string): OpenUINode {
  const vars: Record<string, OpenUINode> = {};
  let last: OpenUINode | null = null;
  for (const raw of statementsOf(src)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    const m = /^([A-Za-z_][\w]*)\s*=\s*([A-Z][A-Za-z]*)\s*\(([\s\S]*)\)\s*;?$/.exec(line);
    if (!m) continue;
    const node = call(m[2], m[3], vars);
    vars[m[1]] = node;
    last = node;
  }
  if (vars.root) return vars.root;
  if (!last) throw new Error("openui: no card");
  return last;
}

