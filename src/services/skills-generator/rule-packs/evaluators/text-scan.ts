/**
 * Lexical helpers shared by deterministic rule-pack evaluators.
 *
 * These operate one line at a time and intentionally stay simple: they
 * neutralize string-literal contents and strip comments so that type/JSX
 * pattern matches never fire inside quoted text or commented-out code.
 *
 * Multi-line strings and block comments are not tracked across line
 * boundaries — acceptable for the single-line heuristic checks that use them,
 * and it keeps the helper allocation-light and dependency-free.
 */

/**
 * Return a "code-only" view of a single line with string-literal contents
 * blanked out and comments removed. Quote/backtick delimiters and stripped
 * regions are replaced with spaces so that match column positions stay close
 * to the original source.
 */
export function stripStringsAndComments(line: string): string {
  let out = "";
  let quote: string | null = null;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    const next = line[i + 1];

    if (quote) {
      if (ch === "\\") {
        out += "  "; // blank the escape and the escaped char
        i++;
        continue;
      }
      out += " ";
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += " ";
      continue;
    }

    if (ch === "/" && next === "/") break; // line comment — drop the rest

    if (ch === "/" && next === "*") {
      const close = line.indexOf("*/", i + 2);
      if (close === -1) break; // unterminated block comment — drop the rest
      out += " ".repeat(close + 2 - i);
      i = close + 1;
      continue;
    }

    out += ch;
  }

  return out;
}

/**
 * True when the finding on `lines[index]` should be suppressed by an explicit
 * eslint opt-out: an `eslint-disable` directive on the same line (e.g.
 * `eslint-disable-line`) or an `eslint-disable-next-line` directive on the
 * immediately preceding line.
 */
export function isEslintSuppressed(lines: readonly string[], index: number): boolean {
  const current = lines[index];
  if (current && current.includes("eslint-disable")) return true;
  const previous = lines[index - 1];
  if (previous && previous.includes("eslint-disable-next-line")) return true;
  return false;
}

/**
 * True when file content looks like a unified diff / git patch rather than
 * plain source. The review pipeline feeds evaluators patch text, so evaluators
 * must avoid flagging removed lines and diff metadata.
 */
export function isPatchContent(content: string): boolean {
  return content.startsWith("diff --git") || /^@@ /m.test(content);
}

/**
 * True when, within patch content, a line is a removed line (`-…`) or diff
 * metadata (`@@`, `+++`, `---`, `diff --git`, `index …`). Added lines (`+…`)
 * and context lines are NOT skipped. No-ops conceptually for plain source —
 * callers gate this behind {@link isPatchContent}.
 */
export function isDiffMetaOrRemovedLine(line: string): boolean {
  return (
    line.startsWith("-") || // removed line or `---` file header
    line.startsWith("+++") || // new-file header
    line.startsWith("@@") || // hunk header
    line.startsWith("diff --git") ||
    line.startsWith("index ")
  );
}

/**
 * Remove a leading unified-diff marker (`+` added / ` ` context) so multi-line
 * constructs can be matched on patch content. No-op for non-patch input. Callers
 * should already have skipped removed (`-`) and metadata lines.
 */
export function stripDiffMarker(line: string, isPatch: boolean): string {
  if (!isPatch) return line;
  return line.startsWith("+") || line.startsWith(" ") ? line.slice(1) : line;
}
