import type { ImportInfo, ExportInfo, SymbolInfo } from "../../../types/index.js";
import { registerExtractor, type LexicalExtractor } from "./lexical-framework.js";

const IMPORT_RE = /^import\s+["']([^"']+)["']/gm;
const EXPORT_RE = /^export\s+["']([^"']+)["']/gm;
const CLASS_RE = /^(?:abstract\s+)?(?:class|mixin)\s+([a-zA-Z_]\w*)/gm;
const FUNC_RE = /^(?:Future|void|int|String|bool|double|var|final)\s+([a-zA-Z_]\w*)\s*\(/gm;
const TYPEDEF_RE = /^typedef\s+([a-zA-Z_]\w*)\s*=/gm;
const ENUM_RE = /^enum\s+([a-zA-Z_]\w*)\s*\{/gm;

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
    const line = lines[i]!;
    const ln = i + 1;

    let m: RegExpExecArray | null;

    IMPORT_RE.lastIndex = 0;
    while ((m = IMPORT_RE.exec(line)) !== null) {
      imports.push({ source: m[1]!, names: [], line: ln, kind: "named" });
    }
    EXPORT_RE.lastIndex = 0;
    while ((m = EXPORT_RE.exec(line)) !== null) {
      imports.push({ source: m[1]!, names: [], line: ln, kind: "named" });
    }
    CLASS_RE.lastIndex = 0;
    while ((m = CLASS_RE.exec(line)) !== null) {
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
    TYPEDEF_RE.lastIndex = 0;
    while ((m = TYPEDEF_RE.exec(line)) !== null) {
      if (!seen.has(m[1]!)) {
        seen.add(m[1]!);
        symbols.push({ name: m[1]!, type: "type", line: ln, column: 0 });
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

const dartExtractor: LexicalExtractor = { language: "dart", extensions: ["dart"], extract };
registerExtractor(dartExtractor);
