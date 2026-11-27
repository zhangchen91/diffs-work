/**
 * Re-exported from `@diffs/diff-ui`.
 *
 * This module used to hold its own `Family` union and `EXT_TO_FAMILY` table, and `apps/local` held
 * a third copy that had already lost `legacy-office`. Adding a format meant editing all of them
 * and hoping they stayed in step. There is one definition now.
 */
export { FORMATS, NEEDS_ENGINE, familyOf, formatMeta, type Family, type FormatMeta } from "@diffs/diff-ui";
