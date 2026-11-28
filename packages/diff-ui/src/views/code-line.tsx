/**
 * One line of code, coloured.
 *
 * Shared by every view that draws source: the split and the single-column both render the same
 * `row.text`, and colouring one but not the other is how a product ends up looking like two
 * different products.
 */
import * as React from "react";
import { highlight, type Token } from "../lib/highlight";
import { TOKEN_COLOURS } from "../lib/token-colours";
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
            // The colour map is shared with the DSH plugin (`token-colours.ts`); the site paints it
            // with its own class names, the plugin with its own, but there is one table.
            className={
              t.kind === "comment"
                ? TOKEN_COLOURS.comment.siteClass
                : t.kind === "string"
                  ? TOKEN_COLOURS.string.siteClass
                  : TOKEN_COLOURS.keyword.siteClass
            }
          >
            {t.text}
          </span>
        ),
      )}
    </span>
  );
}
