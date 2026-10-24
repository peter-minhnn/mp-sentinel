/** Static CommonJS extraction. Does not execute code or guess dynamic module names. */
import type { SyntaxNode } from "tree-sitter";
import type { ImportInfo, ExportInfo, SymbolInfo, CallEdge } from "../../types/index.js";
import { scopedNodes } from "./commonjs-scopes.js";

interface Collected {
  imports: ImportInfo[];
  exports: ExportInfo[];
  symbols: SymbolInfo[];
  calls: CallEdge[];
}

function stringLiteral(node: SyntaxNode | null): string | null {
  if (node?.type !== "string" || node.text.includes("\\")) return null;
  return node.text.slice(1, -1);
}

function member(node: SyntaxNode | null): { object: SyntaxNode; key: string } | null {
  if (!node || !["member_expression", "subscript_expression"].includes(node.type)) return null;
  const object = node.childForFieldName("object");
  const property = node.childForFieldName("property") ?? node.childForFieldName("index");
  const key = property?.type === "property_identifier" ? property.text : stringLiteral(property);
  return object && key ? { object, key } : null;
}

function moduleExports(node: SyntaxNode | null): boolean {
  const value = member(node);
  return (
    value?.object.type === "identifier" && value.object.text === "module" && value.key === "exports"
  );
}

function exportTarget(node: SyntaxNode | null): { global: string; name: string | null } | null {
  if (moduleExports(node)) return { global: "module", name: null };
  const value = member(node);
  if (!value) return null;
  if (moduleExports(value.object)) return { global: "module", name: value.key };
  if (value.object.type === "identifier" && value.object.text === "exports")
    return { global: "exports", name: value.key };
  return null;
}

function requireSource(node: SyntaxNode): string | null {
  if (node.type !== "call_expression") return null;
  const callee = node.childForFieldName("function");
  const args = node
    .childForFieldName("arguments")
    ?.namedChildren.filter((child) => child.type !== "comment");
  if (callee?.type !== "identifier" || callee.text !== "require" || args?.length !== 1) return null;
  return stringLiteral(args[0] ?? null);
}

function requireBinding(node: SyntaxNode): Pick<ImportInfo, "kind" | "names"> {
  const parentMember = member(node.parent);
  if (
    parentMember?.object.startIndex === node.startIndex &&
    parentMember.object.endIndex === node.endIndex
  )
    return { kind: "named", names: [parentMember.key] };
  const parent = node.parent;
  const binding = parent?.type === "variable_declarator" ? parent.childForFieldName("name") : null;
  if (binding?.type === "identifier") return { kind: "namespace", names: [binding.text] };
  if (binding?.type === "object_pattern") {
    const names = binding.namedChildren
      .flatMap((child) => {
        if (child.type === "pair_pattern") {
          const key = child.childForFieldName("key");
          const name = key?.type === "string" ? stringLiteral(key) : key?.text;
          return name ? [name] : [];
        }
        if (child.type === "object_assignment_pattern")
          return [child.childForFieldName("left")?.text ?? ""];
        return child.type === "shorthand_property_identifier_pattern" ? [child.text] : [];
      })
      .filter(Boolean);
    return { kind: "named", names: [...new Set(names)] };
  }
  return { kind: "namespace", names: [] };
}

function callable(node: SyntaxNode): boolean {
  return [
    "function_expression",
    "generator_function",
    "arrow_function",
    "method_definition",
  ].includes(node.type);
}

function addCallable(node: SyntaxNode, name: string, collected: Collected): void {
  if (!callable(node)) return;
  if (
    !collected.symbols.some(
      (symbol) =>
        symbol.name === name &&
        symbol.line === node.startPosition.row + 1 &&
        symbol.column === node.startPosition.column,
    )
  ) {
    collected.symbols.push({
      name,
      type:
        node.type === "arrow_function"
          ? "arrow-function"
          : node.type === "method_definition"
            ? "method"
            : "function",
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column,
    });
  }
  for (const call of collected.calls) {
    const afterStart =
      call.line > node.startPosition.row + 1 ||
      (call.line === node.startPosition.row + 1 && call.column >= node.startPosition.column);
    const beforeEnd =
      call.line < node.endPosition.row + 1 ||
      (call.line === node.endPosition.row + 1 && call.column < node.endPosition.column);
    if (!call.inSymbol && afterStart && beforeEnd) call.inSymbol = name;
  }
}

function objectExports(
  value: SyntaxNode,
  collected: Collected,
  resolve: (name: string) => SyntaxNode | null,
): string[] {
  const names: string[] = [];
  for (const child of value.namedChildren) {
    if (child.type === "shorthand_property_identifier") {
      names.push(child.text);
      const bound = resolve(child.text);
      if (bound) addCallable(bound, child.text, collected);
    }
    if (!["pair", "method_definition"].includes(child.type)) continue;
    const key = child.childForFieldName(child.type === "pair" ? "key" : "name");
    if (!key || !["property_identifier", "identifier", "string"].includes(key.type)) continue;
    const name = key.type === "string" ? stringLiteral(key) : key.text;
    if (name === null) continue;
    names.push(name);
    const fn = child.type === "pair" ? child.childForFieldName("value") : child;
    if (fn?.type === "identifier") {
      const bound = resolve(fn.text);
      if (bound) addCallable(bound, fn.text, collected);
    } else if (fn) addCallable(fn, name, collected);
  }
  return [...new Set(names)];
}

export function collectCommonJs(root: SyntaxNode, collected: Collected): void {
  if (!/\b(?:require|module|exports)\b/.test(root.text)) return;
  for (const { node, shadowed, resolve } of scopedNodes(root)) {
    const source = requireSource(node);
    if (source && !shadowed("require"))
      collected.imports.push({ source, ...requireBinding(node), line: node.startPosition.row + 1 });
    if (node.type !== "assignment_expression") continue;
    const target = exportTarget(node.childForFieldName("left"));
    const value = node.childForFieldName("right");
    if (!target || !value || shadowed(target.global)) continue;
    const names = target.name
      ? [target.name]
      : value.type === "object"
        ? objectExports(value, collected, resolve)
        : [
            value.childForFieldName("name")?.text ??
              (value.type === "identifier" ? value.text : "default"),
          ];
    if (!names.length) continue;
    addCallable(value, names[0]!, collected);
    if (value.type === "identifier") {
      const bound = resolve(value.text);
      if (bound) addCallable(bound, value.text, collected);
    }
    const forwarded = requireSource(value);
    collected.exports.push({
      kind: target.name || value.type === "object" ? "named" : "default",
      names,
      line: node.startPosition.row + 1,
      ...(!target.name && value.type !== "object" ? { isDefault: true } : {}),
      ...(forwarded && !shadowed("require") ? { source: forwarded } : {}),
    });
  }
  collected.imports.sort((a, b) => a.line - b.line);
  collected.exports.sort((a, b) => a.line - b.line);
  collected.symbols.sort((a, b) => a.line - b.line || a.column - b.column);
}
