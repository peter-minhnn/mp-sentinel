/** Frozen benchmark policy: preserve direct exact/name/path seeds, fill from rarity. */
export function preserveSeeds(baseline, experimental, trace, limit = 3) {
  const direct = new Set(
    trace
      .filter(
        (file) =>
          !file.graphOnly &&
          file.contributions.some(
            (hit) =>
              (hit.kind === "symbol" && hit.hitScore >= 90) ||
              (hit.kind === "file" && hit.hitScore >= 95) ||
              (hit.kind === "import" && hit.hitScore >= 90),
          ),
      )
      .map((file) => file.file),
  );
  return mergeProtectedSeeds(baseline, experimental, direct, limit);
}

export function mergeProtectedSeeds(baseline, experimental, direct, limit = 3) {
  const protectedRecords = baseline.slice(0, limit).filter((file) => direct.has(file.file));
  const seen = new Set();
  const records = [...protectedRecords, ...experimental, ...baseline]
    .filter((file) => {
      if (seen.has(file.file)) return false;
      seen.add(file.file);
      return true;
    })
    .map((file, i) => ({ ...file, rank: i + 1 }));
  return { records, protectedFiles: protectedRecords.map((file) => file.file) };
}
