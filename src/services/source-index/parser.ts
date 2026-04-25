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

/**
 * Parse a single file and extract AST information
 */
export async function parseFile(
  filePath: string,
  content: string,
  language: IndexableLanguage,
): Promise<SourceIndexFile | null> {
  try {
    const parser = await getParser(language);
    const tree = parser.parse(content);

    if (!tree || !tree.rootNode) {
      return {
        path: filePath,
        language,
        sha256: "",
        sizeBytes: content.length,
        mtimeMs: Date.now(),
        imports: [],
        exports: [],
        symbols: [],
        parseErrors: ["Failed to parse: no tree generated"],
      };
    }

    const symbols: SymbolInfo[] = [];
    const imports: ImportInfo[] = [];
    const exports: ExportInfo[] = [];

    walkAST(tree.rootNode, symbols, imports, exports);

    // Check for errors
    const parseErrors: string[] = [];
    const hasError =
      typeof tree.rootNode.hasError === "function"
        ? tree.rootNode.hasError()
        : Boolean(tree.rootNode.hasError);
    if (hasError) {
      parseErrors.push("Tree has syntax errors");
    }

    const result: SourceIndexFile = {
      path: filePath,
      language,
      sha256: "",
      sizeBytes: content.length,
      mtimeMs: Date.now(),
      imports,
      exports,
      symbols,
    };
    if (parseErrors.length > 0) {
      result.parseErrors = parseErrors;
    }
    return result;
  } catch (error) {
    log.warning(
      `Parse error in ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {
      path: filePath,
      language,
      sha256: "",
      sizeBytes: content.length,
      mtimeMs: Date.now(),
      imports: [],
      exports: [],
      symbols: [],
      parseErrors: [`${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

/**
 * Check if a file language is supported by tree-sitter
 */
export function isLanguageSupported(path: string): IndexableLanguage | null {
  return getLanguageForFile(path);
}
