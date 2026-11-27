/**
 * Draw the comparison on the page the person is already looking at.
 *
 * The extension used to answer "compare these two selections" by opening a tab — the local viewer
 * or the hosted site — which is a link with extra steps, not a plugin. The complaint was exact:
 * "不然怎么能叫插件呢". This renders into the current page instead, in a panel that can be
 * dismissed, so reading a diff does not cost a navigation or a lost scroll position.
 *
 * Deliberately plain: a content script cannot import the React views (they would drag React into
 * every page it runs on), so this is the same line diff at the same fidelity the CLI prints, styled
 * to sit on top of an arbitrary page. The full views stay one click away.
 */

export interface PanelDiff {
  oldText: string;
  newText: string;
  label?: string;
  /** where the full views live, opened only if asked */
  localUrl?: string;
}

interface Row {
  op: "same" | "add" | "del";
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

/** Line diff by longest common subsequence; the inputs here are selections, so they are small. */
export function lineDiff(oldText: string, newText: string): Row[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows: Row[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      rows.push({ op: "same", text: a[i], oldNo: i + 1, newNo: j + 1 });
      i += 1;
      j += 1;
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
      rows.push({ op: "add", text: b[j], oldNo: null, newNo: j + 1 });
      j += 1;
    } else {
      rows.push({ op: "del", text: a[i], oldNo: i + 1, newNo: null });
      i += 1;
    }
  }
  return rows;
}

const HOST_ID = "diffs-work-inline";

function styles(): string {
  // Every rule is scoped to the host element and every value is explicit: the panel takes over an
  // arbitrary page, and inheriting its font or colours is how a diff becomes unreadable.
  return `
#${HOST_ID}{position:fixed;right:16px;bottom:16px;z-index:2147483646;width:min(680px,calc(100vw - 32px));
  max-height:min(70vh,640px);display:flex;flex-direction:column;font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;
  color:#e6edf3;background:#0d1117;border:1px solid #30363d;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.45);overflow:hidden}
#${HOST_ID} .hd{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #30363d;background:#161b22}
#${HOST_ID} .ttl{font-weight:500;font-size:12.5px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#${HOST_ID} .add{color:#3fb950}#${HOST_ID} .del{color:#f85149}
#${HOST_ID} button{font:inherit;color:#c9d1d9;background:#21262d;border:1px solid #30363d;border-radius:6px;padding:2px 8px;cursor:pointer}
#${HOST_ID} button:hover{background:#30363d}
#${HOST_ID} .bd{overflow:auto;padding:6px 0}
#${HOST_ID} .r{display:flex;white-space:pre;padding:0 12px}
#${HOST_ID} .n{width:36px;flex:none;text-align:right;padding-right:8px;color:#6e7681;user-select:none}
#${HOST_ID} .s{width:14px;flex:none;color:#6e7681}
#${HOST_ID} .t{flex:1;overflow-wrap:anywhere;white-space:pre-wrap}
#${HOST_ID} .r.a{background:rgba(63,185,80,.12)}
#${HOST_ID} .r.d{background:rgba(248,81,73,.12)}
#${HOST_ID} .ft{display:flex;align-items:center;gap:8px;padding:6px 12px;border-top:1px solid #30363d;background:#161b22;font-size:11.5px;color:#8b949e}
#${HOST_ID} .ft a{color:#58a6ff;text-decoration:none}
.host{all:initial}
`;
}

/** Render the panel into `doc`, replacing any previous one. Returns a disposer. */
export function showPanel(diff: PanelDiff, doc: Document = document): () => void {
  doc.getElementById(HOST_ID)?.remove();
  const rows = lineDiff(diff.oldText, diff.newText);
  const added = rows.filter((r) => r.op === "add").length;
  const removed = rows.filter((r) => r.op === "del").length;

  const host = doc.createElement("div");
  host.id = HOST_ID;
  host.className = "host";
  host.setAttribute("role", "dialog");
  host.setAttribute("aria-label", "diffs.work");

  const style = doc.createElement("style");
  style.textContent = styles();

  const head = doc.createElement("div");
  head.className = "hd";
  const title = doc.createElement("span");
  title.className = "ttl";
  title.textContent = diff.label || "对比";
  const counts = doc.createElement("span");
  counts.innerHTML = `<span class="add">+${added}</span> <span class="del">-${removed}</span>`;
  const close = doc.createElement("button");
  close.textContent = "关闭";
  close.onclick = () => host.remove();
  head.append(title, counts, close);

  const body = doc.createElement("div");
  body.className = "bd";
  // Long selections: keep the panel responsive and say how much was left out, rather than
  // freezing the page the reader is working in.
  const LIMIT = 2000;
  for (const r of rows.slice(0, LIMIT)) {
    const row = doc.createElement("div");
    row.className = "r" + (r.op === "add" ? " a" : r.op === "del" ? " d" : "");
    const on = doc.createElement("span");
    on.className = "n";
    on.textContent = r.oldNo == null ? "" : String(r.oldNo);
    const nn = doc.createElement("span");
    nn.className = "n";
    nn.textContent = r.newNo == null ? "" : String(r.newNo);
    const sign = doc.createElement("span");
    sign.className = "s";
    sign.textContent = r.op === "add" ? "+" : r.op === "del" ? "-" : " ";
    const text = doc.createElement("span");
    text.className = "t";
    text.textContent = r.text || " ";
    row.append(on, nn, sign, text);
    body.append(row);
  }
  if (rows.length > LIMIT) {
    const more = doc.createElement("div");
    more.className = "r";
    more.textContent = `… 还有 ${rows.length - LIMIT} 行`;
    body.append(more);
  }

  const foot = doc.createElement("div");
  foot.className = "ft";
  foot.textContent = "文件不出这台机器";
  if (diff.localUrl) {
    const link = doc.createElement("a");
    link.href = diff.localUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "在完整视图里打开 ↗";
    foot.append(link);
  }

  host.append(style, head, body, foot);
  try {
    doc.body.append(host);
  } catch (e) {
    // Report rather than disappear: a panel that silently does not appear is indistinguishable
    // from an extension that is not installed.
    throw new Error("inline panel: could not attach (" + String(e).slice(0, 120) + ")");
  }
  if (!doc.getElementById(HOST_ID)) {
    // The host was appended and then removed by something else on the page. Leave a marker so the
    // next check can tell this apart from a throw.
    doc.documentElement.setAttribute("data-diffs-work-panel", "detached");
  } else {
    doc.documentElement.setAttribute("data-diffs-work-panel", "attached");
  }
  return () => host.remove();
}
