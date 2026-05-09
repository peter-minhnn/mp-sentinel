import type { ImportInfo, ExportInfo, SymbolInfo } from "../../../types/index.js";
import { registerExtractor, type LexicalExtractor } from "./lexical-framework.js";

const REQUIRE_RE = /^(?:require|require_relative|load)\s+["']([^"']+)["']/gm;
const CLASS_RE = /^(?:class|class\s+<<)\s+([a-zA-Z_]\w*)/gm;
const MODULE_RE = /^module\s+([a-zA-Z_]\w*(?:::[a-zA-Z_]\w*)*)/gm;
const DEF_RE = /^def\s+(?:self\.)?([a-zA-Z_]\w*(?:[?!])?)/gm;
const ATTR_RE = /^(?:attr_reader|attr_writer|attr_accessor)\s+(?::)?([a-zA-Z_]\w*)/gm;

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

    REQUIRE_RE.lastIndex = 0;
    while ((m = REQUIRE_RE.exec(line)) !== null) {
      imports.push({ source: m[1]!, names: [], line: ln, kind: "named" });
    }
    CLASS_RE.lastIndex = 0;
    while ((m = CLASS_RE.exec(line)) !== null) {
      if (!seen.has(m[1]!)) {
        seen.add(m[1]!);
        symbols.push({ name: m[1]!, type: "class", line: ln, column: 0 });
      }
    }
    MODULE_RE.lastIndex = 0;
    while ((m = MODULE_RE.exec(line)) !== null) {
      if (!seen.has(m[1]!)) {
        seen.add(m[1]!);
        symbols.push({ name: m[1]!, type: "class", line: ln, column: 0 });
      }
    }
    DEF_RE.lastIndex = 0;
    while ((m = DEF_RE.exec(line)) !== null) {
      if (!seen.has(m[1]!)) {
        seen.add(m[1]!);
        symbols.push({ name: m[1]!, type: "function", line: ln, column: 0 });
      }
    }
    ATTR_RE.lastIndex = 0;
    while ((m = ATTR_RE.exec(line)) !== null) {
      if (!seen.has(m[1]!)) {
        seen.add(m[1]!);
        symbols.push({ name: m[1]!, type: "variable", line: ln, column: 0 });
      }
    }
  }
  return { imports, exports: [], symbols };
}

const rubyExtractor: LexicalExtractor = { language: "ruby", extensions: ["rb"], extract };
registerExtractor(rubyExtractor);
