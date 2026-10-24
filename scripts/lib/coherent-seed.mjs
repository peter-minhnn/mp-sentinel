import { coherentIdentifierEvidence } from "./identifier-evidence.mjs";
import { preserveSeeds, mergeProtectedSeeds } from "./seed-preserve.mjs";

/** Only change from frozen seed preservation: coherent callable components qualify too. */
export function preserveCoherentSeeds(baseline, experimental, trace, records, anchors) {
  const partialEvidence = baseline.slice(0, 3).flatMap((candidate) => {
    const evidence = coherentIdentifierEvidence(records.get(candidate.file), anchors);
    return evidence.length ? [{ file: candidate.file, evidence }] : [];
  });
  const exact = preserveSeeds(baseline, experimental, trace).protectedFiles;
  const protectedFiles = new Set([...exact, ...partialEvidence.map((item) => item.file)]);
  return { ...mergeProtectedSeeds(baseline, experimental, protectedFiles), partialEvidence };
}
