/**
 * Tree-sitter Parser - AST-based code analysis for JS/TS files
 * Uses dynamic imports for ESM compatibility
 */

import { getLanguageForFile } from "./manifest.js";
import type {
  IndexableLanguage,
  ImportInfo,
  ExportInfo,
  SymbolInfo,
  ParserMode,
  SourceIndexFile,
} from "../../types/index.js";
import { log } from "../../utils/logger.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Grammar caches per language
const grammarCaches: Map<string, any> = new Map();
const parserCaches: Map<IndexableLanguage, any> = new Map();

/**
 * Get or create parser for a language
 */
async function getParser(language: IndexableLanguage): Promise<any> {
  const cachedParser = parserCaches.get(language);
  if (cachedParser) {
    return cachedParser;
  }

  // Dynamic import tree-sitter
  const treeSitter = await import("tree-sitter");
  const Parser = treeSitter.default;

  // Load grammar
  let grammar: any;
  if (language === "typescript" || language === "tsx") {
    if (!grammarCaches.has("typescript")) {
      const tsModule = await import("tree-sitter-typescript");
      const grammars = tsModule.default as { typescript: unknown; tsx: unknown };
      grammarCaches.set("typescript", grammars.typescript);
      grammarCaches.set("tsx", grammars.tsx);
    }
    grammar = grammarCaches.get(language);
  } else {
    if (!grammarCaches.has("javascript")) {
      const jsModule = await import("tree-sitter-javascript");
      const grammarModule = jsModule.default as unknown;
      grammarCaches.set("javascript", grammarModule);
      grammarCaches.set("jsx", grammarModule);
    }
    grammar = grammarCaches.get(language);
  }

  if (!grammar) {
    throw new Error(`No grammar available for language: ${language}`);
  }

  const parser = new Parser();
  parser.setLanguage(grammar);
  parserCaches.set(language, parser);

  return parser;
}

/**
 * Symbol node types that we want to extract
 */
const SYMBOL_NODE_TYPES = new Set([
  "function_declaration",
  "class_declaration",
  "interface_declaration",
  "type_alias_declaration",
  "enum_declaration",
  "variable_declaration",
  "method_definition",
  "arrow_function",
]);

/**
 * Import/Export node types
 */
const IMPORT_NODE_TYPES = new Set(["import_statement", "import_declaration"]);

const EXPORT_NODE_TYPES = new Set(["export_statement", "export_declaration"]);

/**
 * Get the name from an identifier node
 */
function getNodeName(node: any): string | null {
  if (!node) return null;

  // Try to find identifier child
  const identifier = node.children.find((child: any) =>
    ["identifier", "type_identifier", "property_identifier"].includes(child.type),
  );
  if (identifier) {
    return identifier.text;
  }

  // For some nodes, the text itself is the name
  if (["identifier", "type_identifier", "property_identifier"].includes(node.type)) {
    return node.text;
  }

  return null;
}

/**
 * Extract symbol information from a function/class declaration node
 */
function extractSymbolInfo(node: any, parentName?: string): SymbolInfo | null {
  const name = getNodeName(node);
  if (!name) return null;

  let symbolType: SymbolInfo["type"];

  switch (node.type) {
    case "function_declaration":
    case "arrow_function":
      symbolType = node.type === "arrow_function" ? "arrow-function" : "function";
      break;
    case "class_declaration":
      symbolType = "class";
      break;
    case "interface_declaration":
      symbolType = "interface";
      break;
    case "type_alias_declaration":
      symbolType = "type";
      break;
    case "enum_declaration":
      symbolType = "enum";
      break;
    case "variable_declaration":
      symbolType = "variable";
      break;
    case "method_definition":
      symbolType = "method";
      break;
    default:
      return null;
  }

  return {
    name,
    type: symbolType,
    line: node.startPosition.row + 1,
    column: node.startPosition.column,
    ...(parentName && { parent: parentName }),
  };
}

/**
 * Extract import information from an import statement node
 */
function extractImportInfo(node: any): ImportInfo | null {
  const imports: string[] = [];
  let kind: ImportInfo["kind"] = "default";
  let source = "";

  for (const child of node.children) {
    if (child.type === "string") {
      source = child.text.slice(1, -1); // Remove quotes
    } else if (child.type === "import_clause") {
      for (const clauseChild of child.children) {
        if (clauseChild.type === "namespace_import") {
          const identifier = clauseChild.children.find((c: any) => c.type === "identifier");
          if (identifier) {
            imports.push(identifier.text);
            kind = "namespace";
          }
        } else if (clauseChild.type === "named_imports") {
          for (const namedChild of clauseChild.children) {
            if (namedChild.type === "import_specifier") {
              const nameNode = namedChild.children.find(
                (c: any) => c.type === "identifier" || c.type === "aliasable_identifier",
              );
              if (nameNode) {
                imports.push(nameNode.text);
              }
            }
          }
          kind = "named";
        } else if (clauseChild.type === "identifier") {
          imports.push(clauseChild.text);
          kind = "default";
        }
      }
    }
  }

  if (!source) return null;

  return {
    source,
    kind,
    names: imports,
    line: node.startPosition.row + 1,
  };
}

/**
 * Extract export information from an export statement node
 */
function extractExportInfo(node: any): ExportInfo | null {
  const exports: string[] = [];
  let kind: ExportInfo["kind"] = "default";
  let source: string | undefined;

  for (const child of node.children) {
    if (child.type === "string") {
      source = child.text.slice(1, -1);
    } else if (child.type === "export_clause") {
      for (const clauseChild of child.children) {
        if (clauseChild.type === "namespace_export") {
          const identifier = clauseChild.children.find((c: any) => c.type === "identifier");
          if (identifier) {
            exports.push(identifier.text);
            kind = "namespace";
          }
        } else if (clauseChild.type === "export_specifier") {
          const nameNode = clauseChild.children.find(
            (c: any) => c.type === "identifier" || c.type === "aliasable_identifier",
          );
          if (nameNode) {
            exports.push(nameNode.text);
          }
        }
      }
      kind = "named";
    } else if (
      child.type === "variable_declarator" ||
      child.type === "function_declaration" ||
      child.type === "class_declaration" ||
      child.type === "interface_declaration" ||
      child.type === "type_alias_declaration" ||
      child.type === "enum_declaration"
    ) {
      // Re-export of a declaration
      const name = getNodeName(child);
      if (name) {
        exports.push(name);
        kind = "named";
      }
    } else if (child.type === "identifier") {
      exports.push(child.text);
      kind = "default";
    }
  }

  if (exports.length === 0) return null;

  const result: ExportInfo = {
    kind,
    names: exports,
    line: node.startPosition.row + 1,
  };
  if (source) {
    result.source = source;
  }
  return result;
}

/**
 * Walk the AST and collect symbols, imports, and exports
 */
function walkAST(
  node: any,
  symbols: SymbolInfo[],
  imports: ImportInfo[],
  exports: ExportInfo[],
  parentName?: string,
): void {
  if (!node || !node.children) return;

  // Check if current node is a symbol
  if (SYMBOL_NODE_TYPES.has(node.type)) {
    const symbol = extractSymbolInfo(node, parentName);
    if (symbol) {
      symbols.push(symbol);
      // For classes, track as parent for methods
      const currentParent = symbol.type === "class" ? symbol.name : parentName;

      // Recurse into children with new parent
      for (const child of node.children) {
        walkAST(child, symbols, imports, exports, currentParent);
      }
      return;
    }
  }

  // Check for imports/exports at top level only
  if (!parentName) {
    if (IMPORT_NODE_TYPES.has(node.type)) {
      const imp = extractImportInfo(node);
      if (imp) imports.push(imp);
    } else if (EXPORT_NODE_TYPES.has(node.type)) {
      const exp = extractExportInfo(node);
      if (exp) exports.push(exp);
    }
  }

  // Recurse into all children
  for (const child of node.children) {
    walkAST(child, symbols, imports, exports, parentName);
  }
}

// Characters that can cause Tree-sitter "Invalid argument" errors on Windows.
// Replace with ASCII equivalents in-memory only — never touch source files.
const RISKY_CHAR_MAP: Array<[RegExp, string]> = [
  // Box drawing
  [/[─-╿]/g, "-"],
  // Dashes
  [/—/g, "--"], // em dash
  [/–/g, "-"], // en dash
  // Arrows
  [/→/g, "->"], // right arrow
  [/←/g, "<-"], // left arrow
  [/↑/g, "^"], // up arrow
  [/↓/g, "v"], // down arrow
  // Typographic
  [/…/g, "..."], // ellipsis
  [/‘/g, "'"], // left single quote
  [/’/g, "'"], // right single quote
  [/“/g, '"'], // left double quote
  [/”/g, '"'], // right double quote
];

function asciiNormalize(content: string): string {
  let result = content;
  for (const [regex, replacement] of RISKY_CHAR_MAP) {
    result = result.replace(regex, replacement);
  }
  return result;
}

/**
 * Replace comments and template literals with spaces (preserving newlines).
 * Regular string literals are NOT stripped — import statements need their
 * `from "..."` strings for regex matching.  False positives from regular
 * strings are caught by {@link isInsideStringLiteral} during lexical parse.
 *
 * Never mutates source files — operates on a copy in memory.
 */
function sanitizeContent(content: string): string {
  const chars = [...content];
  let i = 0;

  const peek = (offset = 0): string => chars[i + offset] ?? "";

  function skipLineComment(): void {
    chars[i] = " ";
    chars[i + 1] = " ";
    i += 2;
    while (i < chars.length && chars[i] !== "\n") {
      chars[i] = " ";
      i++;
    }
  }

  function skipBlockComment(): void {
    chars[i] = " ";
    chars[i + 1] = " ";
    i += 2;
    while (i < chars.length) {
      if (chars[i] === "*" && peek(1) === "/") {
        chars[i] = " ";
        chars[i + 1] = " ";
        i += 2;
        return;
      }
      if (chars[i] !== "\n") chars[i] = " ";
      i++;
    }
  }

  function skipTemplate(): void {
    chars[i] = " ";
    i++;
    while (i < chars.length) {
      if (chars[i] === "\\") {
        chars[i] = " ";
        if (i + 1 < chars.length) chars[i + 1] = " ";
        i += 2;
      } else if (chars[i] === "`") {
        chars[i] = " ";
        i++;
        return;
      } else if (chars[i] === "$" && peek(1) === "{") {
        chars[i] = " ";
        chars[i + 1] = " ";
        i += 2;
        skipTemplateExpression();
      } else {
        if (chars[i] !== "\n") chars[i] = " ";
        i++;
      }
    }
  }

  function skipTemplateExpression(): void {
    let depth = 1;
    while (i < chars.length && depth > 0) {
      const ch = chars[i]!;
      const nx = peek(1);

      if (ch === "{") {
        chars[i] = " ";
        i++;
        depth++;
      } else if (ch === "}") {
        chars[i] = " ";
        i++;
        depth--;
      } else if (ch === "`") {
        skipTemplate();
      } else if (ch === "/" && nx === "/") {
        skipLineComment();
      } else if (ch === "/" && nx === "*") {
        skipBlockComment();
      } else {
        if (ch !== "\n") chars[i] = " ";
        i++;
      }
    }
  }

  while (i < chars.length) {
    const ch = chars[i]!;
    const nx = peek(1);

    if (ch === "/" && nx === "/") {
      skipLineComment();
    } else if (ch === "/" && nx === "*") {
      skipBlockComment();
    } else if (ch === "`") {
      skipTemplate();
    } else {
      i++;
    }
  }

  return chars.join("");
}

/**
 * Check whether a position in the original content falls inside a regular
 * string literal (single- or double-quoted).  Used to reject regex matches
 * that landed on fixture strings.
 */
function isInsideStringLiteral(content: string, position: number): boolean {
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < position && i < content.length; i++) {
    const ch = content[i]!;
    // Count preceding backslashes; odd = escaped
    let bs = 0;
    let j = i - 1;
    while (j >= 0 && content[j] === "\\") {
      bs++;
      j--;
    }
    const escaped = bs % 2 === 1;

    if (ch === "'" && !escaped && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !escaped && !inSingle) {
      inDouble = !inDouble;
    }
  }

  return inSingle || inDouble;
}

/**
 * Lexical fallback: extract imports, exports, and symbols without Tree-sitter.
 * Used when Tree-sitter throws "Invalid argument" and ASCII normalization also fails.
 *
 * Sanitizes the content first — strips comments and template literals so that
 * regexes only see real code tokens.  Regex matches that fall inside regular
 * string literals are rejected via {@link isInsideStringLiteral}.
 */
function lexicalParse(content: string): {
  imports: ImportInfo[];
  exports: ExportInfo[];
  symbols: SymbolInfo[];
} {
  const sanitized = sanitizeContent(content);
  const lines = sanitized.split("\n");
  const originalLines = content.split("\n");
  const imports: ImportInfo[] = [];
  const exports: ExportInfo[] = [];
  const symbols: SymbolInfo[] = [];

  const importFromRe =
    /import\s+(?:(?:type\s+)?(\{[^}]*\})|(\*\s+as\s+\w+)|(\w+))\s*(?:,\s*(?:(\{[^}]*\})|(\*\s+as\s+\w+)|(\w+)))*\s*from\s*["']([^"']+)["']/g;
  const importSideEffectRe = /import\s+["']([^"']+)["']/g;
  const importDynamicRe = /import\s*\(\s*["']([^"']+)["']\s*\)/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const originalLine = originalLines[i] ?? "";
    const lineNum = i + 1;

    // Side-effect imports: import "x"
    let m: RegExpExecArray | null;
    importSideEffectRe.lastIndex = 0;
    while ((m = importSideEffectRe.exec(line)) !== null) {
      if (!isInsideStringLiteral(originalLine, m.index)) {
        imports.push({
          source: m[1]!,
          kind: "named",
          names: [],
          line: lineNum,
        });
      }
    }

    // Dynamic imports
    importDynamicRe.lastIndex = 0;
    while ((m = importDynamicRe.exec(line)) !== null) {
      if (!isInsideStringLiteral(originalLine, m.index)) {
        imports.push({
          source: m[1]!,
          kind: "dynamic",
          names: [],
          line: lineNum,
        });
      }
    }

    // Named/default/namespace imports
    importFromRe.lastIndex = 0;
    while ((m = importFromRe.exec(line)) !== null) {
      if (isInsideStringLiteral(originalLine, m.index)) continue;
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

    // Exports and symbols (supports optional async before function)
    const exportDeclRe =
      /export\s+(default\s+)?(async\s+)?(function|class|interface|type|enum|const|let|var)\s+(\w+)/g;
    exportDeclRe.lastIndex = 0;
    while ((m = exportDeclRe.exec(line)) !== null) {
      if (isInsideStringLiteral(originalLine, m.index)) continue;
      const name = m[4]!;
      const kw = m[3]!;
      exports.push({ kind: "named", names: [name], line: lineNum });
      const symType = keywordToSymbolType(kw);
      symbols.push({ name, type: symType, line: lineNum, column: m.index });
    }

    // Non-exported declarations
    const declRe = /(?<!\bexport\s+)(?:function|class|interface|type|enum|const|let|var)\s+(\w+)/g;
    declRe.lastIndex = 0;
    while ((m = declRe.exec(line)) !== null) {
      if (isInsideStringLiteral(originalLine, m.index)) continue;
      const name = m[1]!;
      // Avoid duplicates with exports already found on same line
      if (!symbols.some((s) => s.name === name && s.line === lineNum)) {
        const fullMatch = m[0];
        let kw = "";
        if (fullMatch.startsWith("function")) kw = "function";
        else if (fullMatch.startsWith("class")) kw = "class";
        else if (fullMatch.startsWith("interface")) kw = "interface";
        else if (fullMatch.startsWith("type")) kw = "type";
        else if (fullMatch.startsWith("enum")) kw = "enum";
        else if (
          fullMatch.startsWith("const") ||
          fullMatch.startsWith("let") ||
          fullMatch.startsWith("var")
        )
          kw = "variable";
        if (kw) {
          const symType = keywordToSymbolType(kw);
          symbols.push({ name, type: symType, line: lineNum, column: m.index });
        }
      }
    }
  }

  return { imports, exports, symbols };
}

function keywordToSymbolType(kw: string): SymbolInfo["type"] {
  switch (kw) {
    case "function":
      return "function";
    case "class":
      return "class";
    case "interface":
      return "interface";
    case "type":
      return "type";
    case "enum":
      return "enum";
    case "const":
    case "let":
    case "var":
    case "variable":
      return "variable";
    default:
      return "function";
  }
}

/** Max characters per chunk for chunked Tree-sitter parsing. */
const MAX_CHUNK_SIZE = 30000;

/**
 * Chunked Tree-sitter fallback for large files.
 *
 * Splits content on line boundaries, parses each chunk independently,
 * and merges the results while preserving correct line numbers via offsets.
 */
export async function chunkedParse(
  content: string,
  language: IndexableLanguage,
  doParse: (parseContent: string) => Promise<{ tree: any; parseErrors: string[] }>,
): Promise<{
  symbols: SymbolInfo[];
  imports: ImportInfo[];
  exports: ExportInfo[];
  parseWarnings: string[];
  parseErrors: string[];
  chunkCount: number;
  chunkSize: number;
  chunkWarningCount: number;
  chunkBoundaryWarningCount: number;
  chunkActionableWarningCount: number;
} | null> {
  const lines = content.split("\n");
  const chunks: Array<{ text: string; startLine: number }> = [];
  let currentChunk = "";
  let chunkStartLine = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const candidate = currentChunk ? currentChunk + "\n" + line : line;

    if (candidate.length > MAX_CHUNK_SIZE && currentChunk.length > 0) {
      // Finalize the current chunk and start a new one
      chunks.push({ text: currentChunk, startLine: chunkStartLine });
      currentChunk = line;
      chunkStartLine = i + 1; // 1-based line number
    } else {
      currentChunk = candidate;
    }
  }

  if (currentChunk) {
    chunks.push({ text: currentChunk, startLine: chunkStartLine });
  }

  if (chunks.length <= 1) {
    // Not enough chunks to be meaningful — let the caller fall through
    return null;
  }

  const allSymbols: SymbolInfo[] = [];
  const allImports: ImportInfo[] = [];
  const allExports: ExportInfo[] = [];
  const allParseWarnings: string[] = [];
  const allParseErrors: string[] = [];
  let boundaryWarningCount = 0;
  let actionableWarningCount = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    try {
      const { tree, parseErrors: chunkErrors } = await doParse(chunk.text);

      if (!tree) {
        allParseErrors.push(`Chunk at line ${chunk.startLine}: no tree generated`);
        actionableWarningCount++;
        continue;
      }

      const symbols: SymbolInfo[] = [];
      const imports: ImportInfo[] = [];
      const exports: ExportInfo[] = [];

      walkAST(tree.rootNode, symbols, imports, exports);

      // Apply line offset to all extracted items
      const lineOffset = chunk.startLine - 1;
      for (const sym of symbols) {
        sym.line += lineOffset;
        allSymbols.push(sym);
      }
      for (const imp of imports) {
        imp.line += lineOffset;
        allImports.push(imp);
      }
      for (const exp of exports) {
        exp.line += lineOffset;
        allExports.push(exp);
      }

      for (const err of chunkErrors) {
        allParseWarnings.push(`Chunk at line ${chunk.startLine}: ${err}`);
        // Chunked parsing splits files on line boundaries, breaking multi-line
        // constructs.  Parse errors in any chunk are overwhelmingly truncation
        // artifacts rather than real syntax errors — real errors are caught by
        // linters, IDE tooling, and the primary (non-chunked) parse path.
        boundaryWarningCount++;
      }
    } catch {
      allParseErrors.push(`Chunk at line ${chunk.startLine}: parse threw`);
      actionableWarningCount++;
    }
  }

  // Deduplicate imports and exports by source/names (can appear across chunk boundaries)
  const seenImports = new Set<string>();
  const dedupedImports: ImportInfo[] = [];
  for (const imp of allImports) {
    const key = `${imp.source}:${imp.kind}:${imp.names.join(",")}`;
    if (!seenImports.has(key)) {
      seenImports.add(key);
      dedupedImports.push(imp);
    }
  }

  const seenExports = new Set<string>();
  const dedupedExports: ExportInfo[] = [];
  for (const exp of allExports) {
    const key = `${exp.kind}:${exp.names.join(",")}`;
    if (!seenExports.has(key)) {
      seenExports.add(key);
      dedupedExports.push(exp);
    }
  }

  return {
    symbols: allSymbols,
    imports: dedupedImports,
    exports: dedupedExports,
    parseWarnings: allParseWarnings,
    parseErrors: allParseErrors,
    chunkCount: chunks.length,
    chunkSize: MAX_CHUNK_SIZE,
    chunkWarningCount: allParseWarnings.length,
    chunkBoundaryWarningCount: boundaryWarningCount,
    chunkActionableWarningCount: actionableWarningCount,
  };
}

/**
 * Parse a single file and extract AST information
 */
export async function parseFile(
  filePath: string,
  content: string,
  language: IndexableLanguage,
): Promise<SourceIndexFile | null> {
  const doParse = async (parseContent: string): Promise<{ tree: any; parseErrors: string[] }> => {
    const parser = await getParser(language);
    const tree = parser.parse(parseContent);
    const errors: string[] = [];

    if (!tree || !tree.rootNode) {
      return { tree: null, parseErrors: ["Failed to parse: no tree generated"] };
    }

    const hasError =
      typeof tree.rootNode.hasError === "function"
        ? tree.rootNode.hasError()
        : Boolean(tree.rootNode.hasError);
    if (hasError) {
      errors.push("Tree has syntax errors");
    }

    return { tree, parseErrors: errors };
  };

  try {
    const { tree, parseErrors } = await doParse(content);

    if (!tree) {
      return {
        path: filePath,
        language,
        sha256: "",
        sizeBytes: content.length,
        mtimeMs: Date.now(),
        imports: [],
        exports: [],
        symbols: [],
        parserMode: "tree-sitter" as ParserMode,
        parseErrors,
      };
    }

    const symbols: SymbolInfo[] = [];
    const imports: ImportInfo[] = [];
    const exports: ExportInfo[] = [];

    walkAST(tree.rootNode, symbols, imports, exports);

    const result: SourceIndexFile = {
      path: filePath,
      language,
      sha256: "",
      sizeBytes: content.length,
      mtimeMs: Date.now(),
      imports,
      exports,
      symbols,
      parserMode: "tree-sitter" as ParserMode,
    };
    if (parseErrors.length > 0) {
      result.parseErrors = parseErrors;
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Tree-sitter can throw "Invalid argument" on Windows when content contains
    // certain Unicode characters (box-drawing, smart quotes, em dashes, etc.)
    // or when the file is too large for a single parse.
    // Recovery order: chunked Tree-sitter → ASCII normalization → lexical fallback.
    if (message.includes("Invalid argument")) {
      // Step 1: Try chunked Tree-sitter parse (handles large files and some Unicode cases).
      const chunked = await chunkedParse(content, language, doParse);
      if (chunked) {
        const parseWarnings = [
          "Invalid argument; parsed with chunked tree-sitter fallback",
          ...chunked.parseWarnings,
        ];
        const result: SourceIndexFile = {
          path: filePath,
          language,
          sha256: "",
          sizeBytes: content.length,
          mtimeMs: Date.now(),
          imports: chunked.imports,
          exports: chunked.exports,
          symbols: chunked.symbols,
          parserMode: "chunked-tree-sitter" as ParserMode,
          parseWarnings,
          chunkCount: chunked.chunkCount,
          chunkSize: chunked.chunkSize,
          chunkWarningCount: chunked.chunkWarningCount,
          chunkBoundaryWarningCount: chunked.chunkBoundaryWarningCount,
          chunkActionableWarningCount: chunked.chunkActionableWarningCount,
        };
        if (chunked.parseErrors.length > 0) {
          result.parseErrors = chunked.parseErrors;
        }
        return result;
      }

      // Step 2: Retry with ASCII-normalized content (in-memory only).
      const normalized = asciiNormalize(content);
      if (normalized !== content) {
        try {
          const { tree, parseErrors: normErrors } = await doParse(normalized);
          if (tree) {
            const symbols: SymbolInfo[] = [];
            const imports: ImportInfo[] = [];
            const exports: ExportInfo[] = [];

            walkAST(tree.rootNode, symbols, imports, exports);

            const result: SourceIndexFile = {
              path: filePath,
              language,
              sha256: "",
              sizeBytes: content.length,
              mtimeMs: Date.now(),
              imports,
              exports,
              symbols,
              parserMode: "ascii-fallback" as ParserMode,
              parseWarnings: ["Invalid argument; parsed with ASCII fallback"],
            };
            if (normErrors.length > 0) {
              result.parseErrors = normErrors;
            }
            return result;
          }
        } catch {
          // ASCII fallback also failed — try lexical fallback below.
        }
      } else {
        // Content is already ASCII but Tree-sitter still threw. Retry once with
        // tree-sitter on the same content in case it was a transient issue.
        try {
          const { tree, parseErrors: retryErrors } = await doParse(content);
          if (tree) {
            const symbols: SymbolInfo[] = [];
            const imports: ImportInfo[] = [];
            const exports: ExportInfo[] = [];

            walkAST(tree.rootNode, symbols, imports, exports);

            const result: SourceIndexFile = {
              path: filePath,
              language,
              sha256: "",
              sizeBytes: content.length,
              mtimeMs: Date.now(),
              imports,
              exports,
              symbols,
              parserMode: "tree-sitter" as ParserMode,
              parseWarnings: ["Invalid argument; parsed with retry"],
            };
            if (retryErrors.length > 0) {
              result.parseErrors = retryErrors;
            }
            return result;
          }
        } catch {
          // Retry also failed — use lexical fallback below.
        }
      }

      // Step 3: Tree-sitter failed entirely — use lexical regex-based fallback.
      log.warning(
        `Lexical fallback used for ${filePath}: Tree-sitter + chunked + ASCII all failed`,
      );
      const lexical = lexicalParse(content);
      return {
        path: filePath,
        language,
        sha256: "",
        sizeBytes: content.length,
        mtimeMs: Date.now(),
        imports: lexical.imports,
        exports: lexical.exports,
        symbols: lexical.symbols,
        parserMode: "lexical-fallback" as ParserMode,
        parseWarnings: ["Invalid argument; parsed with lexical fallback"],
      };
    }

    log.warning(`Parse error in ${filePath}: ${message}`);
    return {
      path: filePath,
      language,
      sha256: "",
      sizeBytes: content.length,
      mtimeMs: Date.now(),
      imports: [],
      exports: [],
      symbols: [],
      parseErrors: [message],
    };
  }
}

/**
 * Check if a file language is supported by tree-sitter
 */
export function isLanguageSupported(path: string): IndexableLanguage | null {
  return getLanguageForFile(path);
}

export { sanitizeContent, lexicalParse };
export type { ImportInfo, ExportInfo, SymbolInfo, SourceIndexFile };
