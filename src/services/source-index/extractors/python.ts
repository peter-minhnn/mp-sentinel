/**
 * Python lexical extractor.
 *
 * Extracts imports, exports, and top-level declarations from .py files
 * using regex. No tree-sitter required.
 */

import type { ImportInfo, ExportInfo, SymbolInfo } from "../../../types/index.js";
import { registerExtractor, type LexicalExtractor } from "./lexical-framework.js";

// ── Regex patterns ─────────────────────────────────────────────────────────

const IMPORT_RE = /^(?:from\s+(\S+)\s+)?import\s+(.+)$/gm;
const FUNCTION_RE = /^(?:async\s+)?def\s+([a-zA-Z_]\w*)\s*\(/gm;
const CLASS_RE = /^class\s+([a-zA-Z_]\w*)\s*(?:\(|:)/gm;
const DECORATOR_RE = /^@([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)/gm;

// ── Extract function ───────────────────────────────────────────────────────

function extract(content: string): {
  imports: ImportInfo[];
  exports: ExportInfo[];
  symbols: SymbolInfo[];
} {
  const imports: ImportInfo[] = [];
  const exports: ExportInfo[] = [];
  const symbols: SymbolInfo[] = [];
  const seenSymbols = new Set<string>();

  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNum = i + 1;

    // ── Imports ──────────────────────────────────────────────────────────

    let match: RegExpExecArray | null;
    IMPORT_RE.lastIndex = 0;
    // Reset lastIndex per-line for gm regex
    const importLine = line.match(/^(?:from\s+(\S+)\s+)?import\s+(.+)$/);
    if (importLine) {
      const [, modulePart, namesPart] = importLine;
      if (modulePart) {
        // from X import Y, Z
        const names = namesPart!
          .split(",")
          .map((n) => n.trim().split(" as ")[0]!.trim().split(".")[0]!.trim())
          .filter((n) => n && !n.startsWith("("));
        // Check for multi-line imports (parenthesized)
        if (namesPart!.includes("(")) {
          // Multi-line import: collect identifiers
          const idents: string[] = [];
          for (let j = i + 1; j < lines.length; j++) {
            const subLine = lines[j]!.trim();
            if (subLine === ")") break;
            if (subLine) {
              const parts = subLine
                .split(",")
                .map((n) => n.trim().split(" as ")[0]!.trim())
                .filter(Boolean);
              idents.push(...parts);
            }
          }
          for (const id of idents.flat()) {
            imports.push({
              source: modulePart,
              names: [id],
              line: lineNum,
              kind: "named",
            });
            if (!seenSymbols.has(id)) {
              symbols.push({ name: id, type: "variable", line: lineNum, column: 0 });
              seenSymbols.add(id);
            }
          }
        } else {
          for (const name of names) {
            imports.push({
              source: modulePart,
              names: [name],
              line: lineNum,
              kind: "named",
            });
            if (!seenSymbols.has(name)) {
              symbols.push({ name, type: "variable", line: lineNum, column: 0 });
              seenSymbols.add(name);
            }
          }
        }
      } else {
        // import X, import X.Y.Z
        const topNames = namesPart!
          .split(",")
          .map((n) => n.trim().split(".")[0]!.trim())
          .filter(Boolean);
        for (const name of topNames) {
          imports.push({
            source: name,
            names: [],
            line: lineNum,
            kind: "named",
          });
          if (!seenSymbols.has(name)) {
            symbols.push({ name, type: "variable", line: lineNum, column: 0 });
            seenSymbols.add(name);
          }
        }
      }
      continue;
    }

    // ── Functions ─────────────────────────────────────────────────────────

    FUNCTION_RE.lastIndex = 0;
    while ((match = FUNCTION_RE.exec(line)) !== null) {
      const name = match[1]!;
      if (!seenSymbols.has(name)) {
        symbols.push({ name, type: "function", line: lineNum, column: 0 });
        seenSymbols.add(name);
      }
    }

    // ── Classes ───────────────────────────────────────────────────────────

    CLASS_RE.lastIndex = 0;
    while ((match = CLASS_RE.exec(line)) !== null) {
      const name = match[1]!;
      if (!seenSymbols.has(name)) {
        symbols.push({ name, type: "class", line: lineNum, column: 0 });
        seenSymbols.add(name);
      }
    }

    // ── Decorators (track as symbols) ─────────────────────────────────────

    DECORATOR_RE.lastIndex = 0;
    while ((match = DECORATOR_RE.exec(line)) !== null) {
      const name = match[1]!;
      if (!seenSymbols.has(name)) {
        symbols.push({ name, type: "function", line: lineNum, column: 0 });
        seenSymbols.add(name);
      }
    }
  }

  return { imports, exports, symbols };
}

// ── Registration ───────────────────────────────────────────────────────────

const pythonExtractor: LexicalExtractor = {
  language: "python",
  extensions: ["py", "pyi"],
  extract,
};

registerExtractor(pythonExtractor);
