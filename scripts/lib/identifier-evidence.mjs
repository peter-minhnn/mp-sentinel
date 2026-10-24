/** Frozen partial-evidence definition: whole components in one callable name. */
const GLUE = new Set(["get", "set", "find", "by", "for", "with", "from", "and", "the", "to", "of"]);
const CALLABLE = new Set(["function", "method", "arrow-function"]);

export function identifierComponents(value) {
  return [
    ...new Set(
      value
        .normalize("NFKC")
        .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2")
        .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .map((part) =>
          part.length > 3 && part.endsWith("s") && !part.endsWith("ss") ? part.slice(0, -1) : part,
        )
        .filter((part) => part.length >= 3 && !GLUE.has(part)),
    ),
  ];
}

export function coherentIdentifierEvidence(record, anchors) {
  const wanted = new Set(anchors.flatMap(identifierComponents));
  return (record?.symbols ?? [])
    .filter((symbol) => CALLABLE.has(symbol.type))
    .flatMap((symbol) => {
      const components = identifierComponents(symbol.name).filter((part) => wanted.has(part));
      return components.length >= 2 ? [{ name: symbol.name, components }] : [];
    });
}
