/** Coverage preservation is a safety proxy, never a substitute for evidence labels. */
export function coverageDecision(before, after) {
  if (!before.length || before.length !== after.length) throw new Error("incomparable guard rows");
  const original = new Map(before.map((row) => [row.query, row]));
  if (
    original.size !== before.length ||
    new Set(after.map((row) => row.query)).size !== after.length
  ) {
    throw new Error("duplicate guard queries");
  }
  const regressions = [];
  let delta = 0;
  let fallbacks = 0;
  const chain = before.every((row) => row.chain) && after.every((row) => row.chain);
  for (const row of after) {
    const old = original.get(row.query);
    if (!old || old.labels !== row.labels || row.labels < 1)
      throw new Error("guard label set changed");
    if (!row.coverageGuard) throw new Error("missing coverage diagnostic");
    if (row.coverageGuard.fallback) {
      fallbacks++;
      if (JSON.stringify(old.capsule) !== JSON.stringify(row.capsule))
        throw new Error("fallback changed baseline capsule");
    }
    const arms = chain ? ["anchored", "plain"] : [null];
    for (const arm of arms) {
      const oldKept = arm ? old.chain.arms[arm].kept : old.labelsInOpenedFiles;
      const newKept = arm ? row.chain.arms[arm].kept : row.labelsInOpenedFiles;
      if (!Number.isInteger(oldKept) || !Number.isInteger(newKept))
        throw new Error("missing quality score");
      if (arm !== "plain") delta += newKept - oldKept;
      if (newKept < oldKept)
        regressions.push({ query: row.query, arm, before: oldKept, after: newKept });
    }
  }
  return {
    scope: chain ? "named-evidence-chain" : "file-coverage-only",
    status: regressions.length
      ? "reject"
      : delta > 0
        ? "candidate-needs-independent-validation"
        : "no-measured-gain",
    queries: after.length,
    fallbacks,
    keptDelta: delta,
    regressions,
  };
}
