/** Predeclared benchmark-only rules. No label, query-specific or repo-specific knobs. */
export const ANCHOR_EXPERIMENTS = ["current", "anchor-select", "anchor-weight", "anchor-both"];

function replaceOnce(source, needle, replacement) {
  if (source.split(needle).length !== 2) throw new Error(`experiment source drift: ${needle}`);
  return source.replace(needle, replacement);
}

export function anchorExperiment(source, variant) {
  if (variant === "current") return source;
  if (!ANCHOR_EXPERIMENTS.includes(variant)) throw new Error("unknown anchor experiment");
  const select = variant === "anchor-select" || variant === "anchor-both";
  const weight = variant === "anchor-weight" || variant === "anchor-both";
  if (select) {
    source = replaceOnce(
      source,
      "ranked.slice(0, MAX_TASK_ANCHORS)",
      "ranked.slice(0, MAX_TASK_ANCHORS * 8)",
    );
    source = replaceOnce(
      source,
      "const anchors = extractTaskAnchors(trimmed);",
      "const anchors = selectExperimentAnchors(index, trimmed);",
    );
    source = replaceOnce(
      source,
      "const anchors = extractTaskAnchors(prompt.trim());",
      "const anchors = selectExperimentAnchors(index, prompt.trim());",
    );
  }
  if (weight) {
    source = replaceOnce(
      source,
      "  anchor: string;\n}",
      "  anchor: string;\n  specificity?: number;\n}",
    );
    source = replaceOnce(
      source,
      "  return { hits, warnings };",
      `  const stats = new Map(anchors.map((anchor) => [anchor, experimentAnchorStats(index, anchor)]));
  return { hits: hits.map((hit) => ({ ...hit, specificity: stats.get(hit.anchor)!.idf })), warnings };`,
    );
    source = replaceOnce(
      source,
      "cur.rrf += weight / (RRF_K + hit.rank);",
      "cur.rrf += (weight * (hit.specificity ?? 1)) / (RRF_K + hit.rank);",
    );
  }
  return (
    source +
    `
export function experimentAnchorStats(index: SourceIndex, anchor: string) {
  const matches = new Set([
    ...querySymbols(index, anchor, Infinity),
    ...queryImports(index, anchor, Infinity),
    ...queryFiles(index, anchor, Math.max(1, index.files.length)),
  ].map((hit) => hit.file));
  const count = matches.size;
  const idf = Math.log((index.files.length + 1) / (count + 1)) / Math.log(index.files.length + 1);
  return { anchor, files: count, idf };
}
function selectExperimentAnchors(index: SourceIndex, prompt: string): string[] {
  return extractTaskAnchors(prompt).map((anchor, order) => ({
    ...experimentAnchorStats(index, anchor), order,
    explicit: anchor.includes("/") || anchor.startsWith("--") || anchor.startsWith("@") || /[a-z][A-Z]|[_-]/.test(anchor),
  })).sort((a, b) => Number(b.explicit) - Number(a.explicit)
    || Number(b.files > 0) - Number(a.files > 0)
    || a.files - b.files || a.order - b.order)
    .slice(0, MAX_TASK_ANCHORS).map((item) => item.anchor);
}
`
  );
}
