/**
 * Vue extractor — extracts imports, exports, and symbols from .vue files.
 *
 * Extracts content from `<script>` blocks (including `<script setup>` and
 * `<script lang="ts">`) and parses them with regex-based lexical analysis.
 *
 * Parser mode: `lexical-fallback` — no tree-sitter required.
 */

import type { ImportInfo, ExportInfo, SymbolInfo } from "../../../types/index.js";

// ── Script block extraction ─────────────────────────────────────────────────

interface ScriptBlock {
  content: string;
  lang: string;
  isSetup: boolean;
}

/**
 * Extract all `<script>` blocks from a .vue SFC file.
 * Handles `<script>`, `<script setup>`, `<script lang="ts">`, `<script setup lang="ts">`.
 */
function extractScriptBlocks(content: string): ScriptBlock[] {
  const blocks: ScriptBlock[] = [];
  const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
  let match: RegExpExecArray | null;

  while ((match = scriptRegex.exec(content)) !== null) {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    const langMatch = attrs.match(/lang\s*=\s*["'](\w+)["']/);
    const setupMatch = attrs.includes("setup");
    blocks.push({
      content: body,
      lang: langMatch?.[1] ?? "javascript",
      isSetup: setupMatch,
    });
  }

  return blocks;
}

// ── Lexical parse of script content ─────────────────────────────────────────

/**
 * Simple regex-based lexical analysis of script block content.
 * Extracts import statements, export declarations, and top-level symbol names.
 */
function lexicalParseScript(
  scriptContent: string,
  lineOffset: number,
): { imports: ImportInfo[]; exports: ExportInfo[]; symbols: SymbolInfo[] } {
  const imports: ImportInfo[] = [];
  const exports: ExportInfo[] = [];
  const symbols: SymbolInfo[] = [];
  const lines = scriptContent.split("\n");

  const importFromRe =
    /import\s+(?:(?:type\s+)?(\{[^}]*\})|(\*\s+as\s+\w+)|(\w+))\s*(?:,\s*(?:(\{[^}]*\})|(\*\s+as\s+\w+)|(\w+)))*\s*from\s*["']([^"']+)["']/g;
  const importSideEffectRe = /import\s+["']([^"']+)["']/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNum = i + 1 + lineOffset;

    // Side-effect imports
    let m: RegExpExecArray | null;
    importSideEffectRe.lastIndex = 0;
    while ((m = importSideEffectRe.exec(line)) !== null) {
      imports.push({
        source: m[1]!,
        kind: "named",
        names: [],
        line: lineNum,
      });
    }

    // Named/default/namespace imports
    importFromRe.lastIndex = 0;
    while ((m = importFromRe.exec(line)) !== null) {
      const source = m[7];
      if (!source) continue;
      const names: string[] = [];
      let kind: ImportInfo["kind"] = "default";
      for (let g = 1; g <= 6; g++) {
        const cap = m[g];
        if (!cap) continue;
        if (cap.startsWith("* as ")) {
          names.push(cap.slice(5).trim());
          kind = "namespace";
        } else if (cap.startsWith("{")) {
          const inner = cap.slice(1, -1);
          const innerNames = inner.split(",").map((s) => {
            const trimmed = s.trim();
            const asIdx = trimmed.lastIndexOf(" as ");
            return asIdx >= 0 ? trimmed.slice(asIdx + 4).trim() : trimmed;
          });
          names.push(...innerNames);
          kind = "named";
        } else {
          names.push(cap.trim());
        }
      }
      imports.push({ source, kind, names, line: lineNum });
    }

    // Export declarations
    const exportDeclRe =
      /export\s+(?:default\s+)?(let|const|var|function|class|interface|type)\s+(\w+)/g;
    let exportMatch: RegExpExecArray | null;
    exportDeclRe.lastIndex = 0;
    while ((exportMatch = exportDeclRe.exec(line)) !== null) {
      exports.push({
        kind: "named",
        names: [exportMatch[2]!],
        line: lineNum,
      });
      symbols.push({
        name: exportMatch[2]!,
        type: exportMatch[1] === "function" ? "function" : "variable",
        line: lineNum,
        column: 0,
      });
    }

    // `defineProps` and `defineEmits` are implicit exports in <script setup>
    if (/defineProps\s*</.test(line)) {
      exports.push({
        kind: "named",
        names: ["props"],
        line: lineNum,
      });
    }
    if (/defineEmits\s*</.test(line)) {
      exports.push({
        kind: "named",
        names: ["emit"],
        line: lineNum,
      });
    }

    // Function declarations
    const funcRe = /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g;
    funcRe.lastIndex = 0;
    for (let funcMatch: RegExpExecArray | null = null; (funcMatch = funcRe.exec(line)) !== null; ) {
      if (!symbols.some((s) => s.name === funcMatch[1] && s.line === lineNum)) {
        symbols.push({
          name: funcMatch[1]!,
          type: "function",
          line: lineNum,
          column: 0,
        });
      }
    }

    // Variable declarations (top-level)
    const varRe = /(?:export\s+)?(?:let|const|var)\s+(\w+)\s*(?:[=:]|$)/g;
    varRe.lastIndex = 0;
    for (let varMatch: RegExpExecArray | null = null; (varMatch = varRe.exec(line)) !== null; ) {
      // Skip if already found on this line
      if (!symbols.some((s) => s.name === varMatch[1] && s.line === lineNum)) {
        symbols.push({
          name: varMatch[1]!,
          type: "variable",
          line: lineNum,
          column: 0,
        });
      }
    }
  }

  return { imports, exports, symbols };
}

// ── Main export function ────────────────────────────────────────────────────

export interface VueExtractResult {
  imports: ImportInfo[];
  exports: ExportInfo[];
  symbols: SymbolInfo[];
}

/**
 * Extract imports, exports, and symbols from a .vue SFC file's content.
 * Parses all `<script>` blocks (including `<script setup>`).
 */
export function extractFromVue(content: string): VueExtractResult {
  const scripts = extractScriptBlocks(content);

  let allImports: ImportInfo[] = [];
  let allExports: ExportInfo[] = [];
  let allSymbols: SymbolInfo[] = [];

  for (const script of scripts) {
    const { imports, exports, symbols } = lexicalParseScript(script.content, 0);
    allImports.push(...imports);
    allExports.push(...exports);
    allSymbols.push(...symbols);
  }

  return { imports: allImports, exports: allExports, symbols: allSymbols };
}
