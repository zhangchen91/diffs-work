/**
 * The shapes the kernel returns for code and Office diffs.
 *
 * They lived in `studio.tsx`, which is the page — so the views had to import from the page that
 * imports them. They belong with the views.
 */
export interface CodeFromRust {
  engine: string;
  summary: string;
  language: string;
  added: number;
  removed: number;
  commentOnly: number;
  lines: Array<{ op: string; oldLine: number | null; newLine: number | null; text: string }>;
  symbolsAdded: Array<{ name: string; kind: string; line: number }>;
  symbolsRemoved: Array<{ name: string; kind: string; line: number }>;
  symbolsChanged: Array<{ name: string; kind: string; change: string; line?: number }>;
  importsAdded: string[];
  importsRemoved: string[];
}

export interface OpcFromRust {
  engine: string;
  kind: "docx" | "pptx";
  summary: string;
  added: number;
  removed: number;
  revisions: Array<{
    part: string;
    path: string;
    kind: string;
    old?: string;
    new?: string;
    oldIndex?: number;
    newIndex?: number;
    paired?: boolean;
    segments?: Array<{ op: "same" | "ins" | "del"; text: string }> | null;
  }>;
}
