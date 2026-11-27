/**
 * A helper extracted out of a caller: the same statements, now behind a name.
 *
 * This is the change a reviewer most wants named, and the one a line diff is worst at. Nothing was
 * added or deleted — statements that were inside `total` are now inside `subtotal`, and `total`
 * calls it. A line diff reports the whole block twice and calls both halves edits.
 *
 * The check is structural but text-based, which keeps it usable from the kernel's output as well
 * as from a plain read:
 *
 *   1. a function exists in the new file that did not exist in the old one;
 *   2. its body is made of lines that already existed in the old file (allow re-indentation);
 *   3. the old file gains a call to that function by name;
 *   4. statements that left the caller are covered by the helper's body.
 *
 * Deliberately conservative: a helper built from repeated boilerplate, or one whose body is mostly
 * new, is not named as an extraction.
 */

export interface Extracted {
  /** the new helper */
  helper: string;
  /** the function it was pulled out of */
  caller: string;
}

const DEF = [
  // Ruby writes `def price` with no parentheses; the C family and Python write `name(` or `name<`.
  /^(?:(?:export|public|private|protected|static|async|final|abstract)\s+)*(?:function|def|func|fn)\s+([A-Za-z_$][\w$]*)\s*(?:[(<]|$)/,
  /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()/,
];

/** Function names declared in a file, with the body line range for the ones we can delimit. */
export function declaredFunctions(lines: string[]): Map<string, { start: number; end: number; indent: number }> {
  const out = new Map<string, { start: number; end: number; indent: number }>();
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    let name: string | null = null;
    for (const re of DEF) {
      const m = re.exec(line.trimStart());
      if (m) {
        name = m[1] ?? null;
        break;
      }
    }
    if (!name) continue;
    const indent = line.length - line.trimStart().length;
    // The body can open on the signature line or the next one (`private function x(): void` then
    // `{`), and either way it ends at the brace that closes the declaration — counting braces is
    // the only thing that works across languages that indent (Python, Ruby) and ones that brace
    // (PHP, Java, the C family).
    let end = i;
    let depth = 0;
    let opened = false;
    for (let j = i; j < lines.length; j += 1) {
      const l = lines[j] ?? "";
      for (const ch of l) {
        if (ch === "{") {
          depth += 1;
          opened = true;
        } else if (ch === "}") depth -= 1;
      }
      if (opened && depth <= 0) {
        end = j;
        break;
      }
      if (!opened) {
        if (j > i && l.trim()) {
          const ind = l.length - l.trimStart().length;
          // A declaration with no braces: indentation decides, as in Python and Ruby.
          if (ind <= indent && !/^[)}\]]/.test(l)) break;
        }
        end = j;
      } else {
        end = j;
      }
    }
    out.set(name, { start: i, end, indent });
  }
  return out;
}

/** The body lines of a declaration, without the signature line, trimmed. */
function bodyOf(lines: string[], at: { start: number; end: number }): string[] {
  return lines
    .slice(at.start + 1, at.end + 1)
    .map((l) => l.trim())
    .filter((l) => l && l !== "}" && l !== "};" && l !== "end");
}

/** True when `text` calls `name(` somewhere a call could be. */
function calls(text: string, name: string): boolean {
  // Ruby and some Scala call without parentheses (`discount` alone on a line), so a name at a
  // statement position counts too. Anchored to the start of a line after optional receivers so a
  // mention inside a longer expression is not mistaken for a call.
  const paren = new RegExp(`(?<![\\w$.])${name}\\s*\\(`);
  if (paren.test(text)) return true;
  // A bare mention still counts, unless it is this very declaration (`def discount`) or a call on
  // some other receiver (`other.discount`), which is a different function.
  const bare = new RegExp(`(?<![\\w$.])${name}(?![\\w$(])`, "g");
  let m: RegExpExecArray | null;
  while ((m = bare.exec(text))) {
    const lineStart = text.lastIndexOf("\n", m.index) + 1;
    const before = text.slice(lineStart, m.index);
    if (/\b(?:def|function|fn|func)\s+$/.test(before)) continue;
    return true;
  }
  return false;
}

/**
 * The extraction that turns `oldText` into `newText`, or null.
 *
 * Returns names only: the ranges are the caller's to work out once it knows what it is looking at,
 * and this stays a function of the two texts.
 */
export function detectExtracted(oldText: string, newText: string): Extracted | null {
  if (oldText === newText) return null;
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const before = declaredFunctions(oldLines);
  const after = declaredFunctions(newLines);

  const fresh = [...after.keys()].filter((n) => !before.has(n));
  if (!fresh.length) return null;
  const oldTrimmed = new Set(oldLines.map((l) => l.trim()).filter(Boolean));

  for (const helper of fresh) {
    const at = after.get(helper)!;
    const body = bodyOf(newLines, at);
    // A helper whose body is mostly new text is new code, not a move of old code.
    if (body.length < 2) continue;
    const fromOld = body.filter((l) => oldTrimmed.has(l)).length;
    if (fromOld / body.length < 0.7) continue;

    // Something that existed before must now call it.
    for (const caller of before.keys()) {
      const a = before.get(caller)!;
      const b = after.get(caller);
      if (!b) continue;
      const oldBody = bodyOf(oldLines, a);
      const newBody = bodyOf(newLines, b);
      if (!calls(newBody.join("\n"), helper)) continue;
      // The statements that left the caller have to be the ones the helper gained.
      const helperLines = new Set(body);
      const left = oldBody.filter((l) => !newBody.includes(l));
      if (!left.length) continue;
      const covered = left.filter((l) => helperLines.has(l)).length;
      if (covered / left.length >= 0.5) return { helper, caller };
    }
  }
  return null;
}

export interface Inlined {
  /** the helper that disappeared */
  helper: string;
  /** the function that absorbed it */
  caller: string;
}

/**
 * The inverse of `detectExtracted`: a helper is gone and its body now sits in its caller.
 *
 * Same evidence, read the other way round. `middleware(app)` disappearing while `init` grows three
 * `app.use(...)` lines is one decision — inline the helper — and a line diff reports it as a deleted
 * function plus three added lines.
 */
export function detectInlined(oldText: string, newText: string): Inlined | null {
  if (oldText === newText) return null;
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const before = declaredFunctions(oldLines);
  const after = declaredFunctions(newLines);

  const gone = [...before.keys()].filter((n) => !after.has(n));
  if (!gone.length) return null;
  const newTrimmed = new Set(newLines.map((l) => l.trim()).filter(Boolean));

  for (const helper of gone) {
    const at = before.get(helper)!;
    const body = bodyOf(oldLines, at);
    if (body.length < 2) continue;
    // Some of the helper's statements have to survive somewhere in the new file. Not all of them:
    // an inlining usually rewrites the last statement to use the inlined value —
    // `base * pct` becomes `base - base * pct` — so demanding 70% missed the plainest case there is.
    // `return X` becomes `X` when it is inlined into a larger expression, so the `return` is not
    // part of what has to survive — only the expression it guarded.
    const core = (l: string) => l.replace(/^return\s+/, "").replace(/;$/, "");
    const newCores = new Set([...newTrimmed].map(core));
    const survived = body.filter((l) => newTrimmed.has(l) || newCores.has(core(l))).length;
    if (survived / body.length < 0.4) continue;

    for (const caller of after.keys()) {
      const a = before.get(caller);
      const b = after.get(caller)!;
      if (!a) continue;
      const newBody = bodyOf(newLines, b);
      // The caller must have been calling it, and must no longer.
      const oldBody = bodyOf(oldLines, a);
      if (!calls(oldBody.join("\n"), helper)) continue;
      if (calls(newBody.join("\n"), helper)) continue;
      // The caller has to have gained those statements.
      const gained = newBody.filter((l) => !oldBody.includes(l));
      const fromHelper = new Set(body);
      const explained = gained.length > 0 && gained.filter((l) => fromHelper.has(l)).length / gained.length >= 0.5;
      // …or the helper had a single expression, which lands on one existing line rather than as a
      // new one: `fn($p) => $this->gross($p)` becoming `fn($p) => round($p * 1.2, 2)` gains nothing
      // and loses nothing, so a line-gain test can never see it. The helper's text has to appear in
      // the caller's new body for that to count.
      const newText = newBody.join("\n");
      const inlineIntoLine = body.some((b) => {
        const core = b.replace(/^return\s+/, "").replace(/;$/, "");
        return core.length > 3 && newText.includes(core);
      });
      if (explained || inlineIntoLine) return { helper, caller };
    }
  }
  return null;
}
