/**
 * One line of code, coloured.
 *
 * Shared by every view that draws source: the split and the single-column both render the same
 * `row.text`, and colouring one but not the other is how a product ends up looking like two
 * different products.
 */
import * as React from "react";
import { highlight, type Token } from "../lib/highlight";
export { highlightLines } from "../lib/highlight";

/** Keyed by the text so a row re-renders only when it changes. */
export function CodeLine({
  text,
  file,
  tone,
  tokens: given,
}: {
  text: string;
  file: string;
  tone?: string;
  /** tokens from `highlightLines`, when the caller has already threaded the state */
  tokens?: Token[];
}): React.ReactElement {
  const { tokens } = React.useMemo(
    () => (given ? { tokens: given } : highlight(text, file)),
    [text, file, given],
  );
  return (
    <span className={tone ?? "text-slate-300"}>
      {tokens.map((t, i) =>
        t.kind === null ? (
          <React.Fragment key={i}>{t.text}</React.Fragment>
        ) : (
          <span
            key={i}
            className={
              t.kind === "comment"
                ? "text-slate-500 italic"
                : t.kind === "string"
                  ? "text-emerald-300/80"
                  : "text-sky-300/90"
            }
          >
            {t.text}
          </span>
        ),
      )}
    </span>
  );
}
