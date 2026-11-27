/**
 * Built-in samples — one per file family, each designed to show exactly one clean
 * example of every diff state:
 *
 *   增  an added line/paragraph with no deletion beside it
 *   删  a removed line/paragraph with no addition beside it
 *   改  an added + deleted pair that clearly correspond
 *   移  identical content at a different position (highest precedence)
 *
 * They are fetched from /examples at click time, never at page load.
 */
export interface Sample {
  id: string;
  /** message key */
  label: string;
  /** message key */
  desc: string;
  oldUrl: string;
  newUrl: string;
  filename: string;
  family: "markdown" | "code" | "text" | "xlsx" | "docx" | "pptx" | "pdf";
}

export const SAMPLES: Sample[] = [
  // The pairs under test-cases/all-ops/ — the cases `pnpm test:acceptance` verifies (one add,
  // delete, edit and move each). What a visitor clicks here is what the tests prove, and there is
  // one copy of every file: the sync step publishes test-cases/ to /examples/allops/.
  {
    id: "code",
    label: "sample.code",
    desc: "sample.code.desc",
    oldUrl: "/examples/allops/code/typescript.before.ts",
    newUrl: "/examples/allops/code/typescript.after.ts",
    filename: "typescript.ts",
    family: "code",
  },
  {
    id: "rust",
    label: "sample.rust",
    desc: "sample.rust.desc",
    oldUrl: "/examples/allops/code/rust.before.rs",
    newUrl: "/examples/allops/code/rust.after.rs",
    filename: "rust.rs",
    family: "code",
  },
  {
    // the same edit in a different language: the structure view shows a different granularity,
    // and a reader comparing two languages can see where the tools agree
    id: "python",
    label: "sample.python",
    desc: "sample.python.desc",
    oldUrl: "/examples/allops/code/python.before.py",
    newUrl: "/examples/allops/code/python.after.py",
    filename: "python.py",
    family: "code",
  },
  {
    // a formatter ran on the right-hand file: every line moved, so the line view is noise and
    // the structure view is the only useful one. This is the case that shows why that view exists.
    id: "reformatted",
    label: "sample.reformatted",
    desc: "sample.reformatted.desc",
    oldUrl: "/examples/allops/code/python-rename.before.py",
    newUrl: "/examples/allops/code/python-rename.after.py",
    filename: "reformatted.py",
    family: "code",
  },
  {
    id: "lua",
    label: "sample.lua",
    desc: "sample.lua.desc",
    oldUrl: "/examples/allops/code/lua.before.lua",
    newUrl: "/examples/allops/code/lua.after.lua",
    filename: "lua.lua",
    family: "code",
  },
  {
    id: "markdown",
    label: "sample.readme",
    desc: "sample.readme.desc",
    oldUrl: "/examples/allops/md.before.md",
    newUrl: "/examples/allops/md.after.md",
    filename: "contract.md",
    family: "markdown",
  },
  {
    id: "excel",
    label: "sample.checklist",
    desc: "sample.checklist.desc",
    oldUrl: "/examples/allops/excel.before.xlsx",
    newUrl: "/examples/allops/excel.after.xlsx",
    filename: "terms.xlsx",
    family: "xlsx",
  },
  {
    id: "word",
    label: "sample.docx",
    desc: "sample.docx.desc",
    oldUrl: "/examples/allops/word.before.docx",
    newUrl: "/examples/allops/word.after.docx",
    filename: "contract.docx",
    family: "docx",
  },
  {
    id: "pptx",
    label: "sample.pptx",
    desc: "sample.pptx.desc",
    oldUrl: "/examples/allops/ppt.before.pptx",
    newUrl: "/examples/allops/ppt.after.pptx",
    filename: "deck.pptx",
    family: "pptx",
  },
  {
    id: "pdf",
    label: "sample.pdf",
    desc: "sample.pdf.desc",
    oldUrl: "/examples/allops/pdf.before.pdf",
    newUrl: "/examples/allops/pdf.after.pdf",
    filename: "letter.pdf",
    family: "pdf",
  },
];
/** Fetch both files of a sample as text (code / markdown). */
export async function loadSample(s: Sample): Promise<[string, string]> {
  const [a, b] = await Promise.all([fetch(s.oldUrl).then((r) => r.text()), fetch(s.newUrl).then((r) => r.text())]);
  return [a, b];
}

/** Fetch both files of a sample as File objects (binary families). */
export async function loadSampleFiles(s: Sample): Promise<[File, File]> {
  const [a, b] = await Promise.all([fetch(s.oldUrl).then((r) => r.blob()), fetch(s.newUrl).then((r) => r.blob())]);
  const nameA = s.oldUrl.split("/").pop() ?? "old";
  const nameB = s.newUrl.split("/").pop() ?? "new";
  return [new File([a], nameA), new File([b], nameB)];
}
