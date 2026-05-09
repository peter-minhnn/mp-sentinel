/**
 * Go lexical extractor.
 *
 * Extracts imports, and top-level declarations from .go files
 * using regex. No tree-sitter required.
 */

import type { ImportInfo, ExportInfo, SymbolInfo } from "../../../types/index.js";
import { registerExtractor, type LexicalExtractor } from "./lexical-framework.js";

// ── Regex patterns ─────────────────────────────────────────────────────────

const IMPORT_RE = /^import\s+(?:"(\S+)"|(\S+)\s+"(\S+)")/gm;
const FUNC_RE = /^func\s+(?:\([^)]*\)\s+)?([a-zA-Z_]\w*)\s*\(/gm;
const TYPE_RE = /^type\s+([a-zA-Z_]\w*)\s*(?:struct|interface|\[|\()/gm;
const CONST_RE = /^const\s+([a-zA-Z_]\w*)\s*=/gm;
const VAR_RE = /^var\s+([a-zA-Z_]\w*)\s*(?:[a-zA-Z*[\]{}]|$)/gm;

// ── Extract function ───────────────────────────────────────────────────────

function extract(content: string): {
  imports: ImportInfo[];
  exports: ExportInfo[];
  symbols: SymbolInfo[];
} {
  const imports: ImportInfo[] = [];
  const symbols: SymbolInfo[] = [];
  const seenSymbols = new Set<string>();

  const lines = content.split("\n");
  let inImportBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    const lineNum = i + 1;

    // ── Import blocks: import ( "fmt" "os" ) ─────────────────────────────

    if (line.startsWith("import (")) {
      inImportBlock = true;
      continue;
    }
    if (inImportBlock && line.startsWith(")")) {
      inImportBlock = false;
      continue;
    }
    if (inImportBlock) {
      const imp = line.replace(/^"|"$/g, "").trim();
      if (imp) {
        imports.push({
          source: imp,
          names: [],
          line: lineNum,
          kind: "named",
        });
      }
      continue;
    }

    // ── Inline import: import "fmt" or import alias "path" ───────────────

    const inlineImport = line.match(/^import\s+(?:([a-zA-Z_.]+)\s+)?"([^"]+)"/);
    if (inlineImport) {
      const [, , path] = inlineImport;
      if (path) {
        imports.push({
          source: path,
          names: inlineImport[1] ? [inlineImport[1]] : [],
          line: lineNum,
          kind: inlineImport[1] ? "named" : "named",
        });
      }
      continue;
    }

    // ── Functions ─────────────────────────────────────────────────────────

    const funcMatch = line.match(FUNC_RE);
    if (funcMatch) {
      const name = funcMatch[1]!;
      if (!seenSymbols.has(name)) {
        // Exported functions (capitalized) are "exports"
        if (name[0]! >= "A" && name[0]! <= "Z") {
          // Capitalized = exported
        }
        symbols.push({ name, type: "function", line: lineNum, column: 0 });
        seenSymbols.add(name);
      }
    }

    // ── Types ─────────────────────────────────────────────────────────────

    const typeMatch = line.match(TYPE_RE);
    if (typeMatch) {
      const name = typeMatch[1]!;
      if (!seenSymbols.has(name)) {
        symbols.push({ name, type: "type", line: lineNum, column: 0 });
        seenSymbols.add(name);
      }
    }

    // ── Consts ────────────────────────────────────────────────────────────

    const constMatch = line.match(CONST_RE);
    if (constMatch) {
      const name = constMatch[1]!;
      if (!seenSymbols.has(name)) {
        symbols.push({ name, type: "variable", line: lineNum, column: 0 });
        seenSymbols.add(name);
      }
    }

    // ── Vars ──────────────────────────────────────────────────────────────

    const varMatch = line.match(VAR_RE);
    if (varMatch) {
      const name = varMatch[1]!;
      if (!seenSymbols.has(name)) {
        symbols.push({ name, type: "variable", line: lineNum, column: 0 });
        seenSymbols.add(name);
      }
    }
  }

  return { imports, exports: [], symbols };
}

// ── Registration ───────────────────────────────────────────────────────────

const goExtractor: LexicalExtractor = {
  language: "go",
  extensions: ["go"],
  extract,
};

registerExtractor(goExtractor);
