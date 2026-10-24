/** Benchmark-only source transform. Never modifies the production source file. */
export function fusionVariant(source, variant) {
  if (variant === "current") return source;
  if (!["distinct-capped", "legacy-votes"].includes(variant))
    throw new Error("unknown fusion variant");
  for (const name of ["querySymbols", "queryImports"]) {
    const needle = `${name}(index, anchor, Infinity)`;
    if (source.split(needle).length !== 2) throw new Error(`source drift: ${needle}`);
    source = source.replace(needle, `${name}(index, anchor, PER_KIND_LIMIT)`);
  }
  if (variant === "distinct-capped") return source;
  const start = source.indexOf("function toKindHits(");
  const end = source.indexOf("async function collectKindHits(", start);
  if (start < 0 || end < 0) throw new Error("source drift: hit conversion boundaries");
  return (
    source.slice(0, start) +
    `function toKindHits(
  rows: Array<{ file: string; score: number }>,
  kind: KindHit["kind"],
  anchor: string,
): KindHit[] {
  return rows.map((row, i) => ({ file: row.file, rank: i + 1, score: row.score, kind, anchor }));
}

` +
    source.slice(end)
  );
}
