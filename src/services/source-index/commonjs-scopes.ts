/** Lexical bindings used to avoid interpreting shadowed CommonJS globals. */
import type { SyntaxNode } from "tree-sitter";

interface Scope {
  names: Set<string>;
  values: Map<string, SyntaxNode>;
  parent: Scope | null;
  functionScope: boolean;
}
export interface ScopedNode {
  node: SyntaxNode;
  shadowed: (name: string) => boolean;
  resolve: (name: string) => SyntaxNode | null;
}
const FUNCTIONS = new Set([
  "function_declaration",
  "function_expression",
  "generator_function",
  "generator_function_declaration",
  "arrow_function",
  "method_definition",
]);

function boundNames(node: SyntaxNode | null): string[] {
  if (!node) return [];
  if (["identifier", "shorthand_property_identifier_pattern"].includes(node.type))
    return [node.text];
  if (["pair_pattern", "assignment_pattern", "object_assignment_pattern"].includes(node.type)) {
    return boundNames(node.childForFieldName(node.type === "pair_pattern" ? "value" : "left"));
  }
  if (["required_parameter", "optional_parameter"].includes(node.type)) {
    return boundNames(node.childForFieldName("pattern"));
  }
  if (
    ["object_pattern", "array_pattern", "formal_parameters", "rest_pattern"].includes(node.type)
  ) {
    return node.namedChildren.flatMap(boundNames);
  }
  return [];
}

/** Bindings are collected before consumers inspect nodes, respecting hoisting/TDZ. */
function importBindings(
  node: SyntaxNode,
  scope: Scope,
  add: (scope: Scope, names: string[]) => void,
): void {
  if (node.type === "import_clause") {
    for (const child of node.namedChildren) {
      if (child.type === "identifier") add(scope, [child.text]);
      if (child.type === "namespace_import")
        add(
          scope,
          child.namedChildren.map((c) => c.text),
        );
      if (child.type === "named_imports") {
        for (const specifier of child.namedChildren) {
          add(
            scope,
            boundNames(specifier.childForFieldName("alias") ?? specifier.childForFieldName("name")),
          );
        }
      }
    }
  }
}

/** Bindings are collected before consumers inspect nodes, respecting hoisting/TDZ. */
export function scopedNodes(root: SyntaxNode): ScopedNode[] {
  const visits: Array<{ node: SyntaxNode; scope: Scope }> = [];
  const initial: Scope = { names: new Set(), values: new Map(), parent: null, functionScope: true };
  const add = (scope: Scope, names: string[]): void => {
    for (const name of names) scope.names.add(name);
  };
  const walk = (node: SyntaxNode, outer: Scope): void => {
    if (
      ["function_declaration", "generator_function_declaration", "class_declaration"].includes(
        node.type,
      )
    ) {
      add(outer, boundNames(node.childForFieldName("name")));
    }
    const fn = FUNCTIONS.has(node.type);
    const scope =
      fn || node.type === "statement_block" || node.type === "catch_clause"
        ? {
            names: new Set<string>(),
            values: new Map<string, SyntaxNode>(),
            parent: outer,
            functionScope: fn,
          }
        : outer;
    if (fn) {
      add(
        scope,
        boundNames(node.childForFieldName("parameters") ?? node.childForFieldName("parameter")),
      );
      add(scope, boundNames(node.childForFieldName("name")));
    }
    if (node.type === "catch_clause") add(scope, boundNames(node.childForFieldName("parameter")));
    if (node.type === "variable_declarator") {
      let target = scope;
      if (node.parent?.type === "variable_declaration") {
        while (!target.functionScope && target.parent) target = target.parent;
      }
      add(target, boundNames(node.childForFieldName("name")));
      const name = node.childForFieldName("name");
      const value = node.childForFieldName("value");
      if (name?.type === "identifier" && value) target.values.set(name.text, value);
    }
    importBindings(node, scope, add);
    if (node.type === "assignment_expression") {
      const left = node.childForFieldName("left");
      if (left?.type === "identifier" && ["require", "module", "exports"].includes(left.text))
        add(scope, [left.text]);
    }
    visits.push({ node, scope });
    for (const child of node.namedChildren) walk(child, scope);
  };
  walk(root, initial);
  return visits.map(({ node, scope }) => ({
    node,
    shadowed: (name: string): boolean => {
      for (let current: Scope | null = scope; current; current = current.parent) {
        if (current.names.has(name)) return true;
      }
      return false;
    },
    resolve: (name: string): SyntaxNode | null => {
      for (let current: Scope | null = scope; current; current = current.parent) {
        if (current.names.has(name)) return current.values.get(name) ?? null;
      }
      return null;
    },
  }));
}
