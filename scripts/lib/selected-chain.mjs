import { measureRow } from "./allocation-bench.mjs";

/** Reuse real chain metrics; intercept only the already-measured task selection. */
export function measureSelectedChain({ row, capsule, candidates, records, query }) {
  const ranking = {
    candidateCount: candidates.length,
    truncated: candidates.length > 50,
    candidates: candidates.slice(0, 50).map((candidate, i) => ({ ...candidate, rank: i + 1 })),
  };
  const wrappedQuery = (args) => {
    if (args[0] !== "--task-context") return query(args);
    const payload = args.includes("--explain-ranking") ? ranking : capsule;
    return { payload, raw: JSON.stringify(payload), latencyMs: 0 };
  };
  return measureRow(row, { id: "baseline", files: 3, agentBudget: 1200 }, records, wrappedQuery);
}
