/**
 * One set of colours for "added / removed / changed / moved", used by every rendered view.
 *
 * Word, slides and PDF each carried their own table and they had drifted: 0.14 in three places,
 * 0.18 and 0.16 in the slides, and the PDF used "added"/"removed" where the others used
 * "insert"/"delete". The reported symptom was exactly that — "打遮盖的规则要统一啊，现在看起来还是
 * 混乱".
 *
 * Paragraph- and block-level tints are deliberately weaker than word-level marks: the paragraph
 * says *where*, the mark says *which characters*.
 */

/** Tint for a whole paragraph, slide or page region. */
export const REGION_TONE = {
  insert: "bg-emerald-500/[0.14]",
  delete: "bg-red-500/[0.12]",
  change: "bg-amber-500/[0.12]",
  move: "bg-violet-500/[0.14]",
} as const;

/** Tint plus text colour, for a region whose text should read as changed too. */
export const REGION_TONE_TEXT = {
  insert: "bg-emerald-500/[0.14] text-emerald-700",
  delete: "bg-red-500/[0.12] text-red-700 line-through decoration-red-400/60",
  change: "bg-amber-500/[0.12] text-amber-800",
  move: "bg-violet-500/[0.14] text-violet-700",
} as const;

/** Tint for the characters that changed inside a region. */
export const MARK_TONE = {
  ins: "bg-emerald-500/25",
  del: "bg-red-500/25 line-through decoration-red-500/60",
} as const;

/** The same two marks, inverted for a dark background (the PDF canvas sits on one). */
export const MARK_TONE_DARK = {
  ins: "bg-emerald-400/30 ring-1 ring-emerald-500/70",
  del: "bg-red-400/30 ring-1 ring-red-500/70",
} as const;
