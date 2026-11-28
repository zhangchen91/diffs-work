/**
 * How a syntax token is coloured, in one place for both surfaces.
 *
 * The site draws a token by name (`text-slate-300`, `text-emerald-300/80`) because it has Tailwind;
 * the DSH plugin draws it by class (`dsw-hl-keyword`) because the host has no Tailwind. The two were
 * therefore separate, and a colour change on one side silently left the other behind.
 *
 * This file is the single mapping. Each entry names the token kind and the CSS custom property the
 * colour resolves to, so a surface translates it into whatever that surface paints with — and a
 * token kind that gains a colour is added here once.
 */

/** The token kinds the highlighter emits. `null` means "leave the default colour". */
export type TokenKind = "comment" | "string" | "keyword";

/** One kind's styling, expressed as a theme variable plus a fallback. */
export interface TokenColour {
  /** The CSS custom property a surface should use, if it has one. */
  readonly variable: string;
  /** The colour to use when the surface has no such variable (the site's dark palette). */
  readonly fallback: string;
  /** Whether the kind is drawn in italics (comments are). */
  readonly italic: boolean;
  /** The Tailwind classes the website paints this kind with. */
  readonly siteClass: string;
}

/**
 * The colours, keyed by token kind.
 *
 * The variables follow DSH's host tokens, because they are the ones a plugin can rely on being
 * present; the site maps the same names to its own theme in `globals.css`.
 */
export const TOKEN_COLOURS: Readonly<Record<TokenKind, TokenColour>> = {
  comment: { variable: "--dsw-color-text-tertiary", fallback: "#8b949e", italic: true, siteClass: "text-slate-500 italic" },
  string: { variable: "--dsw-color-string", fallback: "#7ee2b8", italic: false, siteClass: "text-emerald-300/80" },
  keyword: { variable: "--dsw-color-keyword", fallback: "#8ecdf5", italic: false, siteClass: "text-sky-300/90" },
};

/**
 * One declaration for a token kind, for a surface that writes plain CSS.
 * @param kind - the token kind.
 * @returns a CSS declaration body (`color: …; font-style: …`).
 */
export function tokenDeclaration(kind: TokenKind): string {
  const colour = TOKEN_COLOURS[kind];
  return `color:var(${colour.variable},${colour.fallback})` + (colour.italic ? ";font-style:italic" : "");
}
