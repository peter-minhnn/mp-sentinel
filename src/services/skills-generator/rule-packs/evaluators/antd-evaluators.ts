/**
 * Ant Design rule-pack evaluators — deterministic checks for AntD projects.
 *
 * `no-hardcoded-hex-color` flags hardcoded hex color literals used in styling
 * contexts. AntD theming should flow through `ConfigProvider` design tokens,
 * not scattered hex values, so the palette stays consistent and themeable.
 *
 * To keep precision high the check requires BOTH a hex literal AND a
 * styling-related keyword on the same line — a bare `#abc123` in an unrelated
 * string (an id, a hash, a route) is not flagged.
 */

import type { FileEvaluator, FileEvaluatorResult } from "../index.js";
import { isDiffMetaOrRemovedLine, isEslintSuppressed, isPatchContent } from "./text-scan.js";

/** 3-, 4-, 6-, or 8-digit hex color literal. */
const HEX_COLOR_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/;

/** Styling context that makes a nearby hex literal almost certainly a color. */
const STYLE_CONTEXT_RE =
  /\b(color|colour|background|backgroundColor|border|borderColor|fill|stroke|boxShadow|shadow|outline|gradient|theme|token|tint|accent|bg)\b/i;

function isTsxFile(filePath: string): boolean {
  return /\.(ts|tsx|jsx)$/.test(filePath);
}

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

/**
 * Flag hardcoded hex colors used in styling contexts.
 */
export const noHardcodedHexColor: FileEvaluator = {
  ruleId: "no-hardcoded-hex-color",
  evaluate: ({ filePath, content, lines }): FileEvaluatorResult[] => {
    if (!isTsxFile(filePath)) return [];

    const patch = isPatchContent(content);
    const results: FileEvaluatorResult[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (patch && isDiffMetaOrRemovedLine(line)) continue;
      if (isCommentLine(line) || isEslintSuppressed(lines, i)) continue;
      if (!HEX_COLOR_RE.test(line) || !STYLE_CONTEXT_RE.test(line)) continue;

      const col = line.search(HEX_COLOR_RE);
      results.push({
        ruleId: "no-hardcoded-hex-color",
        passed: false,
        message:
          "Hardcoded hex color in a styling context — route AntD theming through `ConfigProvider` design tokens instead of scattered hex values.",
        line: i + 1,
        column: (col >= 0 ? col : 0) + 1,
        severity: "WARNING",
        suggestion:
          "Replace the hex literal with a `ConfigProvider` theme token (e.g. `colorPrimary`, `colorError`) or a shared design-token constant.",
      });
    }

    return results;
  },
};
