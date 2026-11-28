/**
 * The numbers that decide how a diff row looks.
 *
 * The site and the DSH plugin draw the same comparison, but the site writes its metrics as Tailwind
 * classes (`text-[12.5px] leading-[1.6] py-[1px]`) and the plugin as CSS. Those drifted: the plugin
 * inherited the host's chat typography, so the card read as a different widget even once the colours
 * matched. These constants are the single source; each surface renders them in its own dialect.
 */

/** One row's typography and box. */
export interface DiffRowMetrics {
  /** The code's font size, in pixels. */
  readonly fontSize: number;
  /** Its line height, as a multiple of the font size. */
  readonly lineHeight: number;
  /** The line-number column's font size. */
  readonly numberSize: number;
  /** Vertical padding of a row, in pixels. */
  readonly paddingY: number;
  /** Horizontal padding of a row, in pixels. */
  readonly paddingX: number;
  /** Width of one line-number column, in pixels. */
  readonly numberWidth: number;
}

/**
 * The row metrics, matching the site's `hunk-view.tsx`.
 *
 * 12.5px is unusual on purpose: at 13px a long line wraps in a narrow column, and at 12px the font
 * hinting of the monospace stack makes punctuation hard to tell apart.
 */
export const DIFF_ROW_METRICS: DiffRowMetrics = {
  fontSize: 12.5,
  lineHeight: 1.6,
  numberSize: 11,
  paddingY: 1,
  paddingX: 12,
  numberWidth: 38,
};

/**
 * The row metrics as a CSS declaration block, for a surface that writes CSS.
 * @returns declarations suitable for a `.row { … }` rule.
 */
export function rowCss(): string {
  const m = DIFF_ROW_METRICS;
  return `padding:${m.paddingY}px ${m.paddingX}px;font-size:${m.fontSize}px;line-height:${m.lineHeight};`;
}

/**
 * The line-number cell as a CSS declaration block.
 * @returns declarations suitable for a `.line-number { … }` rule.
 */
export function numberCss(): string {
  const m = DIFF_ROW_METRICS;
  return `width:${m.numberWidth}px;font-size:${m.numberSize}px;line-height:${m.lineHeight};`;
}
