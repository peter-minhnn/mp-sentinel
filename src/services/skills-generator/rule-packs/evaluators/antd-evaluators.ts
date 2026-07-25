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
 *
 * Emits one finding per occurrence; the deterministic-review engine
 * aggregates 3+ same-rule hits in one file into a single finding, so this
 * evaluator stays simple and consistent with every other rule.
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

/**
 * `antd-type-import` flags AntD type exports pulled in as VALUE imports, e.g.
 * `import { TableProps } from 'antd'` — these should be `import type` (or use an
 * inline `type` modifier). Type-only imports are erased from the JS bundle and
 * are required under `verbatimModuleSyntax`; the project's own rule also lists
 * type-only antd imports (`UploadFile`, `TableProps`, …) as a distinct category.
 *
 * Precision-first: AntD's type exports overwhelmingly end in `Props` or `Type`,
 * or belong to a small known set — none of AntD's runtime value exports (Table,
 * Button, Form, message, theme, …) do — so name-matching is unambiguous. The
 * check is single-line (AntD imports are conventionally one line); an already
 * `import type` statement or an inline `type X` specifier is left untouched.
 */
const ANTD_NAMED_IMPORT_RE =
  /^\+?\s*import\s+(type\s+)?(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*['"]antd['"]/;

/** AntD type exports that do not end in `Props`/`Type`. */
const KNOWN_ANTD_TYPES = new Set<string>([
  "UploadFile",
  "UploadChangeParam",
  "FormInstance",
  "RadioChangeEvent",
  "CheckboxChangeEvent",
  "TreeDataNode",
  "MenuInfo",
  "GetProp",
  "GetProps",
  "GetRef",
]);

const isAntdTypeName = (name: string): boolean =>
  /(?:Props|Type)$/.test(name) || KNOWN_ANTD_TYPES.has(name);

/**
 * Flag AntD type exports imported in value position (should be `import type`).
 */
export const antdTypeImport: FileEvaluator = {
  ruleId: "antd-type-import",
  evaluate: ({ filePath, content, lines }): FileEvaluatorResult[] => {
    if (!/\.(ts|tsx|mts|cts|jsx)$/.test(filePath) || filePath.endsWith(".d.ts")) return [];

    const patch = isPatchContent(content);
    const results: FileEvaluatorResult[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (patch && isDiffMetaOrRemovedLine(line)) continue;
      if (isEslintSuppressed(lines, i)) continue;

      const match = ANTD_NAMED_IMPORT_RE.exec(line);
      if (!match) continue;
      if (match[1]) continue; // `import type { … } from 'antd'` — already type-only

      const typeNames = (match[2] ?? "")
        .split(",")
        .map((spec) => spec.trim())
        .filter((spec) => spec.length > 0 && !/^type\s+/.test(spec)) // inline `type X` already fine
        .map((spec) => spec.split(/\s+as\s+/)[0]!.trim())
        .filter(isAntdTypeName);
      if (typeNames.length === 0) continue;

      const first = typeNames[0]!;
      const col = line.indexOf(first);
      results.push({
        ruleId: "antd-type-import",
        passed: false,
        message: `AntD type${typeNames.length > 1 ? "s" : ""} ${typeNames
          .map((n) => `\`${n}\``)
          .join(
            ", ",
          )} imported as a value — use \`import type\` (or an inline \`type\` modifier) so they are elided from the JS output and satisfy \`verbatimModuleSyntax\`.`,
        line: i + 1,
        column: (col >= 0 ? col : 0) + 1,
        severity: "INFO",
        suggestion:
          "Move type-only names to `import type { … } from 'antd'`, or mark them inline: `import { Table, type TableProps } from 'antd'`.",
      });
    }

    return results;
  },
};
