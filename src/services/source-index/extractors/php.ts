import type { ImportInfo, ExportInfo, SymbolInfo } from "../../../types/index.js";
import { registerExtractor, type LexicalExtractor } from "./lexical-framework.js";

const USE_RE = /^use\s+([a-zA-Z_\\][\w\\]*)(?:\s+as\s+([a-zA-Z_]\w*))?/gm;
const CLASS_RE = /^(?:abstract\s+|final\s+)?class\s+([a-zA-Z_]\w*)/gm;
const INTERFACE_RE = /^interface\s+([a-zA-Z_]\w*)/gm;
const TRAIT_RE = /^trait\s+([a-zA-Z_]\w*)/gm;
const FUNC_RE = /^function\s+([a-zA-Z_]\w*)\s*\(/gm;
const ENUM_RE = /^enum\s+([a-zA-Z_]\w*)/gm;

function extract(content: string): {
  imports: ImportInfo[];
  exports: ExportInfo[];
  symbols: SymbolInfo[];
} {
  const imports: ImportInfo[] = [];
  const symbols: SymbolInfo[] = [];
  const seen = new Set<string>();

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    const ln = i + 1;
    let m: RegExpExecArray | null;

    USE_RE.lastIndex = 0;
    while ((m = USE_RE.exec(line)) !== null) {
      imports.push({ source: m[1]!, names: m[2] ? [m[2]!] : [], line: ln, kind: "named" });
      const short = m[2] ?? m[1]!.split("\\").pop()!;
      if (!seen.has(short)) {
        seen.add(short);
        symbols.push({ name: short, type: "variable", line: ln, column: 0 });
      }
    }
    CLASS_RE.lastIndex = 0;
    while ((m = CLASS_RE.exec(line)) !== null) {
      if (!seen.has(m[1]!)) {
        seen.add(m[1]!);
        symbols.push({ name: m[1]!, type: "class", line: ln, column: 0 });
      }
    }
    INTERFACE_RE.lastIndex = 0;
    while ((m = INTERFACE_RE.exec(line)) !== null) {
      if (!seen.has(m[1]!)) {
        seen.add(m[1]!);
        symbols.push({ name: m[1]!, type: "interface", line: ln, column: 0 });
      }
    }
    TRAIT_RE.lastIndex = 0;
    while ((m = TRAIT_RE.exec(line)) !== null) {
      if (!seen.has(m[1]!)) {
        seen.add(m[1]!);
        symbols.push({ name: m[1]!, type: "class", line: ln, column: 0 });
      }
    }
    FUNC_RE.lastIndex = 0;
    while ((m = FUNC_RE.exec(line)) !== null) {
      if (!seen.has(m[1]!)) {
        seen.add(m[1]!);
        symbols.push({ name: m[1]!, type: "function", line: ln, column: 0 });
      }
    }
    ENUM_RE.lastIndex = 0;
    while ((m = ENUM_RE.exec(line)) !== null) {
      if (!seen.has(m[1]!)) {
        seen.add(m[1]!);
        symbols.push({ name: m[1]!, type: "enum", line: ln, column: 0 });
      }
    }
  }
  return { imports, exports: [], symbols };
}

const phpExtractor: LexicalExtractor = { language: "php", extensions: ["php"], extract };
registerExtractor(phpExtractor);
