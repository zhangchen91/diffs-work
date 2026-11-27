/**
 * The surface the browser half actually talks to.
 *
 * Written by hand on purpose: the module table, the slot context and the tool payload
 * are three small contracts, and copying their full host types in here would couple the
 * plugin to a DSH release. These are the parts the card depends on.
 */

/** A row of the tool payload, normalised from hunks / semantic / AST. */
export interface DiffRow {
  op: "add" | "del" | "mod" | "move" | "same";
  oldLine: number | null | undefined;
  newLine: number | null | undefined;
  text: string;
  segments?: Array<{ op: "same" | "ins" | "del"; text: string }> | null;
  node?: boolean;
  /** raw kernel kind, kept for the card's op colouring */
  kind?: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffRow[];
  /** AST hunks carry a column range and an operation name instead of rows */
  operation?: string;
  range?: { start_row: number; start_column: number; end_row: number; end_column: number };
  text?: string;
}

/** What `diff_compare` returns, as far as the card is concerned. */
export interface DiffPayload {
  kind?: string;
  summary?: string;
  name?: string;
  oldPath?: string;
  newPath?: string;
  family?: string;
  moves?: number;
  updates?: number;
  modified?: number;
  moved?: number;
  before?: { hunks?: DiffHunk[] };
  after?: { hunks?: DiffHunk[] };
  oldLabel?: string;
  newLabel?: string;
  added?: number;
  removed?: number;
  updated?: number;
  truncated?: boolean;
  note?: string;
  unified?: string;
  hunks?: Array<{ header?: string; lines?: Array<Partial<DiffRow> & { kind?: string; oldNo?: number | null; newNo?: number | null }> }>;
  semantic?: { summary?: string; updates?: number; moves?: number; moveBlocks?: Array<{ fromStart: number; toStart: number; text?: string }> };
  ast?: {
    summary?: string;
    updates?: number;
    moves?: number;
    inserts?: number;
    deletes?: number;
    after?: { hunks?: Array<{ operation?: string; text?: string; range?: { start_row: number; start_column: number; end_row: number; end_column: number } }> };
  };
  types?: { summary?: string; definitions?: Array<{ name: string; type?: { type: string } | null; file: string; line: number; column: number }> };
  binary?: unknown;
  /** The same comparison as OpenUI Lang, when the result carried one. */
  openui?: string;
  /** `diffs.work/portable@1` when the payload came from this plugin's host half. */
  schema?: string;
  /** What the call did, on a card this plugin produced. */
  operation?: string;
  /** One changed file, for a shell command that touched several. */
  path?: string;
  counts?: { added: number; removed: number; changed: number; ratio: number } | null;
}

/** One comparison, as the pending list stores it. */
export interface DiffRecord {
  id: string;
  name: string;
  summary?: string;
  /** the same comparison as OpenUI Lang v0.1, when the host supplied it */
  openui?: string;
  /** keep the raw payload for the list's expandable view */
  payload?: DiffPayload;
  oldPath?: string | null;
  newPath?: string | null;
  family?: string;
  /* filled in by record() from the labels the host half already rendered */
  oldLabel?: string;
  newLabel?: string;
  added: number;
  removed: number;
  modified?: number;
  moved?: number;
  kind?: string;
  hunks: DiffHunk[];
  binary?: boolean;
  pending?: boolean;
  note?: string;
  truncated?: boolean;
  unified?: string;
  at?: number;
}

export interface SlotContext {
  effect?(fn: () => void | (() => void)): void;
  slots: {
    inject(name: string, fn: () => unknown): void;
    register(options: Record<string, unknown>, component: unknown): unknown;
  };
  get(name: string): unknown;
}

/** The React subset the card uses. */
export interface ReactLike {
  createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown;
  createContext<T>(value: T): { Provider: unknown };
  useContext<T>(ctx: unknown): T;
  useState<T>(v: T): [T, (next: T | ((prev: T) => T)) => void];
  useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
  useMemo<T>(fn: () => T, deps?: unknown[]): T;
  useRef<T>(v: T): { current: T };
  createElementNS?(ns: string, type: string, props?: Record<string, unknown> | null): unknown;
}

export interface ModuleLoader {
  load(entry: { id: string; factory: (require: (name: string) => unknown) => unknown }): void;
}

declare global {
  interface Window {
    __ModuleLoader__: ModuleLoader;
    __DIFFS_LOCAL_URL__?: string;
  }
}