/**
 * XML structure diff (WordprocessingML / SpreadsheetML / config files).
 *
 * NOTE: nothing consumes this yet. Word and Excel are compared by the kernel reading OOXML
 * directly, and no app imports this module; it is kept because the tests describe a workable
 * element-path diff and it costs nothing at runtime (nothing bundles it). If a future surface
 * needs structure-aware XML diffing, this is the candidate — and the first thing to check it is
 * still correct is `node --test packages/core-xml/test/`, which passes today.
 *
 * Text diffs over XML just see one enormous line. This walks elements into a
 * path (`w:body > w:p[3] > w:r > w:t`) and compares *paths whose text changed*,
 * so `w:t` runs inside `w:p[12]` show up as edits in that paragraph, not as a
 * wall of red.
 *
 * Small on purpose: no DTDs, no namespaces resolution, no entity expansion
 * beyond the five XML entities. Attributes compare as text.
 */
export interface XmlNode {
  tag: string;
  path: string;
  attrs: Record<string, string>;
  text: string;
  children: XmlNode[];
}

export interface XmlDoc {
  root: XmlNode;
  /** path → text, flattened in document order */
  nodes: Array<{ path: string; tag: string; text: string; attrs: Record<string, string> }>;
}

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, n) => ENT[n])
    .replace(/&amp;/g, "&");
}

const TOKEN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[^>]+>|[^<]+/g;

/** Parse into a tree; tolerant of malformed input (unclosed tags close at EOF). */
export function parseXml(src: string): XmlDoc {
  const clean = src.replace(/^\uFEFF/, "");
  const root: XmlNode = { tag: "#root", path: "", attrs: {}, text: "", children: [] };
  const stack: XmlNode[] = [root];
  let seq = 0;

  for (const m of clean.matchAll(TOKEN)) {
    const tok = m[0];
    if (tok.startsWith("<!--") || tok.startsWith("<?") || tok.startsWith("<!")) {
      if (tok.startsWith("<![CDATA[")) stack[stack.length - 1].text += tok.slice(9, -3);
      continue;
    }
    if (tok.startsWith("</")) {
      const tag = tok.slice(2, -1).trim();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    if (tok.startsWith("<")) {
      const selfClose = tok.endsWith("/>");
      const inner = tok.slice(1, selfClose ? -2 : -1).trim();
      const m2 = /^([^\s/>]+)([\s\S]*)$/.exec(inner);
      if (!m2) continue;
      const tag = m2[1];
      const attrs: Record<string, string> = {};
      for (const a of m2[2].matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
        attrs[a[1]] = decode(a[3] ?? a[4] ?? "");
      }
      const parent = stack[stack.length - 1];
      const sameTag = parent.children.filter((c) => c.tag === tag).length;
      const seg = sameTag ? `${tag}[${sameTag + 1}]` : tag;
      const node: XmlNode = {
        tag,
        path: parent.path ? `${parent.path}/${seg}` : seg,
        attrs,
        text: "",
        children: [],
      };
      seq++;
      parent.children.push(node);
      if (!selfClose) stack.push(node);
      continue;
    }
    const text = decode(tok);
    if (text.trim()) stack[stack.length - 1].text += text;
  }

  const nodes: XmlDoc["nodes"] = [];
  const walk = (n: XmlNode) => {
    if (n.tag !== "#root") {
      nodes.push({ path: n.path, tag: n.tag, text: n.text.trim(), attrs: n.attrs });
    }
    for (const c of n.children) walk(c);
  };
  walk(root);
  void seq;
  return { root, nodes };
}

export interface XmlChange {
  path: string;
  tag: string;
  op: "add" | "del" | "mod";
  old?: string;
  new?: string;
  /** attribute-level changes, when the element text itself is equal */
  attrChanged?: Array<{ name: string; old?: string; new?: string }>;
}

export interface XmlDiff {
  kind: "xml";
  changes: XmlChange[];
  counts: { add: number; del: number; mod: number; attr: number };
  /** the deepest element whose text changed — readable context for the UI */
  summary: string;
  truncated: boolean;
}

const MAX = 2000;

/** Compare two XML documents by element path. */
export function diffXml(oldSrc: string, newSrc: string): XmlDiff {
  const a = parseXml(oldSrc);
  const b = parseXml(newSrc);
  const mapA = new Map(a.nodes.map((n) => [n.path, n]));
  const mapB = new Map(b.nodes.map((n) => [n.path, n]));

  const changes: XmlChange[] = [];
  let truncated = false;
  const push = (c: XmlChange) => {
    if (changes.length >= MAX) {
      truncated = true;
      return;
    }
    changes.push(c);
  };

  const all = [...new Set([...mapA.keys(), ...mapB.keys()])];
  const counts = { add: 0, del: 0, mod: 0, attr: 0 };

  for (const path of all) {
    const na = mapA.get(path);
    const nb = mapB.get(path);
    if (!na && nb) {
      counts.add++;
      push({ path, tag: nb.tag, op: "add", new: nb.text || undefined });
      continue;
    }
    if (na && !nb) {
      counts.del++;
      push({ path, tag: na.tag, op: "del", old: na.text || undefined });
      continue;
    }
    if (!na || !nb) continue;
    if (na.text !== nb.text) {
      counts.mod++;
      push({ path, tag: nb.tag, op: "mod", old: na.text, new: nb.text });
      continue;
    }
    const attrNames = new Set([...Object.keys(na.attrs), ...Object.keys(nb.attrs)]);
    const attrChanged = [...attrNames]
      .filter((k) => na.attrs[k] !== nb.attrs[k])
      .map((k) => ({ name: k, old: na.attrs[k], new: nb.attrs[k] }));
    if (attrChanged.length) {
      counts.attr += attrChanged.length;
      push({ path, tag: nb.tag, op: "mod", attrChanged });
    }
  }

  const summary =
    changes.length === 0
      ? "两份 XML 结构一致"
      : `${counts.mod} 处文本变化 · +${counts.add} / -${counts.del} · 属性 ${counts.attr}`;

  return { kind: "xml", changes, counts, summary, truncated };
}

/** Human-readable context for one change: the ancestor tags without indices. */
export function contextOf(path: string): string {
  return path
    .split("/")
    .map((p) => p.replace(/\[\d+\]$/, ""))
    .filter((p) => p !== "#root")
    .join(" › ");
}