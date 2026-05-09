/**
 * Svelte extractor — extracts imports, exports, and symbols from .svelte files.
 *
 * Extracts content from `<script>` blocks (including `<script lang="ts">` and
 * `<script context="module">`) and parses them with regex-based lexical analysis.
 *
 * Parser mode: `lexical-fallback` — no tree-sitter required.
 */

import type { ImportInfo, ExportInfo, SymbolInfo } from "../../../types/index.js";

// ── Script block extraction ─────────────────────────────────────────────────

interface ScriptBlock {
  content: string;
  lang: string;
  isModule: boolean;
}

/**
 * Extract all `<script>` blocks from a .svelte file.
 * Handles `<script>`, `<script lang="ts">`, `<script context="module">`, etc.
 */
function extractScriptBlocks(content: string): ScriptBlock[] {
  const blocks: ScriptBlock[] = [];
  const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
  let match: RegExpExecArray | null;

  while ((match = scriptRegex.exec(content)) !== null) {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    const langMatch = attrs.match(/lang\s*=\s*["'](\w+)["']/);
    const moduleMatch = attrs.match(/context\s*=\s*["']module["']/);
    blocks.push({
      content: body,
      lang: langMatch?.[1] ?? "javascript",
      isModule: moduleMatch !== null,
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

    // Export declarations: `export let x`, `export const x`
    const exportLetRe = /export\s+(let|const|var|function|class|interface|type)\s+(\w+)/g;
    let exportMatch: RegExpExecArray | null;
    exportLetRe.lastIndex = 0;
    while ((exportMatch = exportLetRe.exec(line)) !== null) {
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

    // Svelte 5 runes: `let count = $state(0)`
    const runeRe = /(?:let|const|var)\s+(\w+)\s*=\s*\$(\w+)\s*\(/g;
    runeRe.lastIndex = 0;
    while ((m = runeRe.exec(line)) !== null) {
      // $state, $derived, $effect are state declarations
      symbols.push({
        name: m[1]!,
        type: "variable",
        line: lineNum,
        column: 0,
      });
    }

    // Function declarations: `function name(...)`
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
  }

  return { imports, exports, symbols };
}

// ── Main export function ────────────────────────────────────────────────────

export interface SvelteExtractResult {
  imports: ImportInfo[];
  exports: ExportInfo[];
  symbols: SymbolInfo[];
}

/**
 * Extract imports, exports, and symbols from a .svelte file's content.
 * Parses all `<script>` blocks (instance and module context).
 */
export function extractFromSvelte(content: string): SvelteExtractResult {
  const scripts = extractScriptBlocks(content);

  // Count lines before each script block to calculate proper line offsets
  // for the content in the original file
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
