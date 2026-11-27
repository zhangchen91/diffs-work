/**
 * The one shape every file type's diff is reduced to. See docs/diff-protocol.md.
 *
 * Each engine grew its own vocabulary — code says `insert`, sheets say `add`, Word says
 * `change` — so anything that wanted to show or count a diff had to learn four of them. The
 * adapters below are the only place those names are translated.
 */
export type Op = "add" | "del" | "mod" | "move";

export interface Change {
  /** At least one, most significant first. A moved function with an edited line is ["move","mod"]. */
  ops: Op[];
  /** Which file / sheet / slide. Empty for formats with a single container. */
  container: string;
  /** Where inside it, as the reader would say it: "C4", "第 3 段", "第 2 页". */
  where: string;
  before?: string;
  after?: string;
  from?: string;
  to?: string;
}

export interface DiffResult {
  engine: string;
  kind: string;
  summary: string;
  changes: Change[];
  totals: Record<Op, number>;
}

const KNOWN: Record<string, Op> = {
  // add
  add: "add", added: "add", ins: "add", insert: "add", inserted: "add", insertion: "add",
  // del
  del: "del", delete: "del", deleted: "del", rm: "del", remove: "del", removed: "del", deletion: "del",
  // mod
  mod: "mod", modify: "mod", modified: "mod", change: "mod", changed: "mod", update: "mod", updated: "mod",
  // move
  move: "move", moved: "move",
};

/** Engine word → protocol op. Unknown words are dropped rather than guessed. */
export function toOp(word: string): Op | null {
  return KNOWN[word] ?? null;
}

export function totalsOf(changes: Change[]): Record<Op, number> {
  const t: Record<Op, number> = { add: 0, del: 0, mod: 0, move: 0 };
  for (const c of changes) for (const o of c.ops) t[o]++;
  return t;
}

/** Build a result, counting totals once so callers cannot disagree with the list. */
export function result(engine: string, kind: string, summary: string, changes: Change[]): DiffResult {
  return { engine, kind, summary, changes, totals: totalsOf(changes) };
}
