/**
 * Rust lexical extractor.
 *
 * Extracts imports (`use`), and top-level declarations from .rs files
 * using regex. No tree-sitter required.
 */

import type { ImportInfo, ExportInfo, SymbolInfo } from "../../../types/index.js";
import { registerExtractor, type LexicalExtractor } from "./lexical-framework.js";

// ── Regex patterns ─────────────────────────────────────────────────────────

const USE_RE = /^use\s+(.+);$/gm;
const FN_RE = /^(?:(?:pub\s+)?(?:unsafe\s+)?(?:async\s+)?)?fn\s+([a-zA-Z_]\w*)\s*\(/gm;
const STRUCT_RE = /^(?:pub\s+)?struct\s+([a-zA-Z_]\w*)\s*(?:<|{|;)/gm;
const ENUM_RE = /^(?:pub\s+)?enum\s+([a-zA-Z_]\w*)\s*(?:<|{|;)/gm;
const TRAIT_RE = /^(?:pub\s+)?(?:unsafe\s+)?trait\s+([a-zA-Z_]\w*)\s*(?:<|:|{)/gm;
const IMPL_RE = /^(?:pub\s+)?(?:unsafe\s+)?impl\s+(?:<[^>]*>\s*)?([a-zA-Z_]\w*)\s*(?:<|for|{)/gm;
const TYPE_RE = /^(?:pub\s+)?type\s+([a-zA-Z_]\w*)\s*=/gm;
const CONST_RE = /^(?:pub\s+)?const\s+([a-zA-Z_]\w*)\s*:/gm;
const STATIC_RE = /^(?:pub\s+)?static\s+(?:mut\s+)?([a-zA-Z_]\w*)\s*:/gm;
const MOD_RE = /^(?:pub\s+)?mod\s+([a-zA-Z_]\w*)\s*(?:;|{)/gm;
const MACRO_RE = /^(?:pub\s+)?macro_rules!\s*\{?\s*([a-zA-Z_]\w*)/gm;

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
  let inUseBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    const lineNum = i + 1;

    // ── Use block: use { ... } ───────────────────────────────────────────

    if (line.startsWith("use ") && line.includes("{") && !line.includes(";")) {
      inUseBlock = true;
      const prefix = line.match(/^use\s+([^{]+)::\{/);
      if (prefix && prefix[1]) {
        // Single-line use with nested braces: use crate::{A, B, C};
        // Actually this has a semicolon - handled below. This case is multi-line.
        continue;
      }
      continue;
    }
    if (inUseBlock) {
      if (line.startsWith("}") || line.endsWith("}")) {
        inUseBlock = false;
        continue;
      }
      const ident = line.replace(",", "").trim();
      if (ident && !ident.startsWith("//")) {
        imports.push({
          source: ident,
          names: [ident],
          line: lineNum,
          kind: "named",
        });
        if (!seenSymbols.has(ident)) {
          symbols.push({ name: ident, type: "variable", line: lineNum, column: 0 });
          seenSymbols.add(ident);
        }
      }
      continue;
    }

    // ── Inline use: use crate::module; ───────────────────────────────────

    let match: RegExpExecArray | null;
    USE_RE.lastIndex = 0;
    while ((match = USE_RE.exec(line)) !== null) {
      const path = match[1]!;
      imports.push({
        source: path,
        names: [],
        line: lineNum,
        kind: "named",
      });

      // Extract last segment as import symbol
      const lastSeg = path.split("::").pop()?.split(" as ")[0]?.trim();
      if (lastSeg && !seenSymbols.has(lastSeg)) {
        symbols.push({ name: lastSeg, type: "variable", line: lineNum, column: 0 });
        seenSymbols.add(lastSeg);
      }
    }

    // ── Functions ─────────────────────────────────────────────────────────

    FN_RE.lastIndex = 0;
    while ((match = FN_RE.exec(line)) !== null) {
      const name = match[1]!;
      if (!seenSymbols.has(name)) {
        symbols.push({ name, type: "function", line: lineNum, column: 0 });
        seenSymbols.add(name);
      }
    }

    // ── Structs ──────────────────────────────────────────────────────────

    STRUCT_RE.lastIndex = 0;
    while ((match = STRUCT_RE.exec(line)) !== null) {
      const name = match[1]!;
      if (!seenSymbols.has(name)) {
        symbols.push({ name, type: "class", line: lineNum, column: 0 });
        seenSymbols.add(name);
      }
    }

    // ── Enums ────────────────────────────────────────────────────────────

    ENUM_RE.lastIndex = 0;
    while ((match = ENUM_RE.exec(line)) !== null) {
      const name = match[1]!;
      if (!seenSymbols.has(name)) {
        symbols.push({ name, type: "enum", line: lineNum, column: 0 });
        seenSymbols.add(name);
      }
    }

    // ── Traits ───────────────────────────────────────────────────────────

    TRAIT_RE.lastIndex = 0;
    while ((match = TRAIT_RE.exec(line)) !== null) {
      const name = match[1]!;
      if (!seenSymbols.has(name)) {
        symbols.push({ name, type: "interface", line: lineNum, column: 0 });
        seenSymbols.add(name);
      }
    }

    // ── Impl blocks ──────────────────────────────────────────────────────

    IMPL_RE.lastIndex = 0;
    while ((match = IMPL_RE.exec(line)) !== null) {
      const name = match[1]!;
      if (!seenSymbols.has(name)) {
        symbols.push({ name, type: "function", line: lineNum, column: 0 });
        seenSymbols.add(name);
      }
    }

    // ── Type aliases ─────────────────────────────────────────────────────

    TYPE_RE.lastIndex = 0;
    while ((match = TYPE_RE.exec(line)) !== null) {
      const name = match[1]!;
      if (!seenSymbols.has(name)) {
        symbols.push({ name, type: "type", line: lineNum, column: 0 });
        seenSymbols.add(name);
      }
    }

    // ── Consts ───────────────────────────────────────────────────────────

    CONST_RE.lastIndex = 0;
    while ((match = CONST_RE.exec(line)) !== null) {
      const name = match[1]!;
      if (!seenSymbols.has(name)) {
        symbols.push({ name, type: "variable", line: lineNum, column: 0 });
        seenSymbols.add(name);
      }
    }

    // ── Statics ──────────────────────────────────────────────────────────

    STATIC_RE.lastIndex = 0;
    while ((match = STATIC_RE.exec(line)) !== null) {
      const name = match[1]!;
      if (!seenSymbols.has(name)) {
        symbols.push({ name, type: "variable", line: lineNum, column: 0 });
        seenSymbols.add(name);
      }
    }

    // ── Modules ──────────────────────────────────────────────────────────

    MOD_RE.lastIndex = 0;
    while ((match = MOD_RE.exec(line)) !== null) {
      const name = match[1]!;
      if (!seenSymbols.has(name)) {
        symbols.push({ name, type: "type", line: lineNum, column: 0 });
        seenSymbols.add(name);
      }
    }

    // ── Macros ───────────────────────────────────────────────────────────

    MACRO_RE.lastIndex = 0;
    while ((match = MACRO_RE.exec(line)) !== null) {
      const name = match[1]!;
      if (!seenSymbols.has(name)) {
        symbols.push({ name, type: "function", line: lineNum, column: 0 });
        seenSymbols.add(name);
      }
    }
  }

  return { imports, exports: [], symbols };
}

// ── Registration ───────────────────────────────────────────────────────────

const rustExtractor: LexicalExtractor = {
  language: "rust",
  extensions: ["rs"],
  extract,
};

registerExtractor(rustExtractor);
