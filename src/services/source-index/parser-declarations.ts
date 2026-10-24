/** Typed AST declaration extraction shared by the parser. */
import type { SyntaxNode } from "tree-sitter";
import type { SymbolInfo, ImportInfo, ExportInfo } from "../../types/index.js";

/**
 * Get the name from an identifier node
 */
function getNodeName(node: SyntaxNode): string | null {
  if (!node) return null;

  // Try to find identifier child
  const identifier = node.children.find((child: SyntaxNode) =>
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
export function extractSymbolInfo(node: SyntaxNode, parentName?: string): SymbolInfo | null {
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
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column,
    ...(parentName && { parent: parentName }),
  };
}

/**
 * Extract import information from an import statement node
 */
export function extractImportInfo(node: SyntaxNode): ImportInfo | null {
  const imports: string[] = [];
  let kind: ImportInfo["kind"] = "default";
  let source = "";

  for (const child of node.children) {
    if (child.type === "string") {
      source = child.text.slice(1, -1); // Remove quotes
    } else if (child.type === "import_clause") {
      for (const clauseChild of child.children) {
        if (clauseChild.type === "namespace_import") {
          const identifier = clauseChild.children.find((c: SyntaxNode) => c.type === "identifier");
          if (identifier) {
            imports.push(identifier.text);
            kind = "namespace";
          }
        } else if (clauseChild.type === "named_imports") {
          for (const namedChild of clauseChild.children) {
            if (namedChild.type === "import_specifier") {
              const nameNode = namedChild.children.find(
                (c: SyntaxNode) => c.type === "identifier" || c.type === "aliasable_identifier",
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
export function extractExportInfo(node: SyntaxNode): ExportInfo | null {
  const exports: string[] = [];
  let kind: ExportInfo["kind"] = "default";
  let source: string | undefined;

  for (const child of node.children) {
    if (child.type === "string") {
      source = child.text.slice(1, -1);
    } else if (child.type === "export_clause") {
      for (const clauseChild of child.children) {
        if (clauseChild.type === "namespace_export") {
          const identifier = clauseChild.children.find((c: SyntaxNode) => c.type === "identifier");
          if (identifier) {
            exports.push(identifier.text);
            kind = "namespace";
          }
        } else if (clauseChild.type === "export_specifier") {
          const nameNode = clauseChild.children.find(
            (c: SyntaxNode) => c.type === "identifier" || c.type === "aliasable_identifier",
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
