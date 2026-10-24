/** Append diagnostics to the isolated benchmark bundle, not the production API. */
export function withFusionTrace(source) {
  return (
    source +
    `
export async function traceFusion(index: SourceIndex, prompt: string) {
  const anchors = extractTaskAnchors(prompt.trim());
  const { hits } = await collectKindHits(index, anchors, undefined);
  const roles = new Map(index.files.map((file: SourceIndexFile) => [file.path, file.role]));
  const fused = fuseByFile(hits, roles);
  const direct = new Set(fused.keys());
  const contributions = new Map<string, Array<{anchor: string; kind: string; hitRank: number; hitScore: number; rrf: number}>>();
  for (const hit of hits) {
    const rrf = fuseByFile([hit], roles).get(hit.file)?.rrf ?? 0;
    const entries = contributions.get(hit.file) ?? [];
    entries.push({ anchor: hit.anchor, kind: hit.kind, hitRank: hit.rank, hitScore: hit.score, rrf });
    contributions.set(hit.file, entries);
  }
  expandGraph(index, rankedSeedPaths(fused).slice(0, GRAPH_SEED_LIMIT), fused);
  return rankedSeedPaths(fused).map((file, i) => {
    const info = fused.get(file)!;
    const entries = contributions.get(file) ?? [];
    const sum = entries.reduce((n, entry) => n + entry.rrf, 0);
    if (direct.has(file) && Math.abs(sum - info.rrf) > 1e-10) throw new Error("trace contribution mismatch");
    return { file, rank: i + 1, rrf: info.rrf,
      exactMultiplier: info.exact ? EXACT_BOOST : 1,
      effectiveScore: info.rrf * (info.exact ? EXACT_BOOST : 1),
      graphOnly: !direct.has(file), contributions: entries };
  });
}
export { packCapsule as packExperimentCapsule };
`
  );
}
