/**
 * Pure scoring for the task_context -> agent_context chain bench.
 *
 * Kept separate from the I/O so the scoring rules can be regression-tested
 * directly -- in particular the degenerate cases where there is nothing to
 * score. An empty denominator is an invalid measurement, never a perfect one.
 */

export const CHAIN_DEFAULTS = {
  taskBudget: 800,
  agentBudget: 1200,
  openFiles: 3,
  anchorRetentionMin: 0.85,
  // Ratcheted after the 2026-09-05 ranking fix (tuning slice measured 0.7632):
  // the improvement is now the floor, with headroom for index drift.
  evidenceRetentionMin: 0.7,
  // Guardrail against a ranking regression. Tuning slice measured 0.2368.
  rankingLossMax: 0.3,
};

const ratio = (kept, total) => (total === 0 ? null : Number((kept / total).toFixed(4)));
const sum = (rows, pick) => rows.reduce((total, row) => total + pick(row), 0);

/** Where a labeled file was lost before packing ever saw it. */
export const LOSS_CAUSES = ["not-candidate", "outside-top-n", "dropped-by-task-budget", "unknown"];

/** An empty, complete ranking response is still usable diagnostic data. */
export function hasRankingData(payload) {
  return Boolean(
    payload &&
    Array.isArray(payload.candidates) &&
    Number.isInteger(payload.candidateCount) &&
    payload.candidateCount >= 0 &&
    typeof payload.truncated === "boolean" &&
    payload.candidates.length === Math.min(payload.candidateCount, 50) &&
    payload.truncated === payload.candidateCount > payload.candidates.length &&
    payload.candidates.every(
      (candidate, i) => typeof candidate.file === "string" && candidate.rank === i + 1,
    ),
  );
}

/**
 * Classify why a labeled file is missing from the opened set, using the
 * ranked candidate list as it stands *before* packing.
 *
 * `rank` is the file's position in that list, or 0 when it is not there.
 * "Not there" only means `not-candidate` when the list is complete: if the
 * listing was truncated, or there is no ranking data at all, the honest answer
 * is `unknown` -- absence from a cut list proves nothing.
 */
export function classifyMissingFile({ rank, truncated, hasRanking, openFiles }) {
  if (!hasRanking) return "unknown";
  if (rank > 0) return rank <= openFiles ? "dropped-by-task-budget" : "outside-top-n";
  return truncated ? "unknown" : "not-candidate";
}

function evidenceCauses(rows) {
  const counts = Object.fromEntries(LOSS_CAUSES.map((c) => [c, 0]));
  for (const row of rows) {
    for (const [cause, labels] of Object.entries(row.rankingCauses ?? {})) {
      counts[cause] = (counts[cause] ?? 0) + labels;
    }
  }
  return counts;
}

/**
 * Score measured rows.
 *
 * Each row carries what the bench observed for one task query; this function
 * decides what passes. Returns `{ summary, failures }` -- `failures` empty
 * means the run is both valid and within its gates.
 */
export function sliceSummary(rows, config = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return summarizeChain(rows, config).summary;
}

export function summarizeChain(rows, config = {}) {
  const cfg = { ...CHAIN_DEFAULTS, ...config };
  const failures = [];

  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      summary: { valid: false, taskQueries: 0, reason: "no task rows measured" },
      failures: ["no task rows measured"],
    };
  }

  const unscorable = [];
  for (const row of rows) {
    if (row.opened.length === 0) {
      // task_context returning nothing is a retrieval failure, not a free win:
      // it also makes the row's token count look great.
      failures.push(`task ${JSON.stringify(row.query)}: task_context opened no files`);
      unscorable.push({ query: row.query, reason: "no-files" });
      continue;
    }
    if (row.evidenceTotal === 0) {
      failures.push(`task ${JSON.stringify(row.query)}: no evidence labels in the corpus`);
      unscorable.push({ query: row.query, reason: "no-evidence-labels" });
      continue;
    }
    if (row.answerableAnchors === 0) {
      unscorable.push({ query: row.query, reason: "no-answerable-anchors" });
    }
  }

  const chainCeiling = cfg.taskBudget + cfg.openFiles * cfg.agentBudget;
  for (const row of rows) {
    if (row.anchoredTokens > chainCeiling) {
      failures.push(
        `chain ${JSON.stringify(row.query)}: ${row.anchoredTokens} tokens > ${chainCeiling}`,
      );
    }
  }

  const anchorTotal = sum(rows, (r) => r.answerableAnchors);
  const anchoredRetention = ratio(
    sum(rows, (r) => r.anchoredKept),
    anchorTotal,
  );
  const plainRetention = ratio(
    sum(rows, (r) => r.plainKept),
    anchorTotal,
  );
  if (anchorTotal === 0) {
    failures.push("no answerable anchors across the corpus: anchor retention is not measurable");
  } else {
    if (anchoredRetention + 1e-9 < plainRetention) {
      failures.push(`anchored anchor retention ${anchoredRetention} < plain ${plainRetention}`);
    }
    if (anchoredRetention < cfg.anchorRetentionMin) {
      failures.push(`anchored anchor retention ${anchoredRetention} < ${cfg.anchorRetentionMin}`);
    }
  }

  const evidenceTotal = sum(rows, (r) => r.evidenceTotal);
  const rankingMiss = sum(rows, (r) => r.evidenceRankingMiss);
  const anchoredPackingMiss = sum(rows, (r) => r.evidenceAnchoredPackingMiss);
  const plainPackingMiss = sum(rows, (r) => r.evidencePlainPackingMiss);
  const anchoredEvidence = ratio(evidenceTotal - rankingMiss - anchoredPackingMiss, evidenceTotal);
  const plainEvidence = ratio(evidenceTotal - rankingMiss - plainPackingMiss, evidenceTotal);

  if (evidenceTotal === 0) {
    failures.push("no evidence labels across the corpus: evidence retention is not measurable");
  } else {
    if (anchoredPackingMiss > plainPackingMiss) {
      failures.push(
        `anchored packing loss ${anchoredPackingMiss} > plain ${plainPackingMiss} evidence items`,
      );
    }
    if (anchoredEvidence < cfg.evidenceRetentionMin) {
      failures.push(
        `anchored evidence retention ${anchoredEvidence} < ${cfg.evidenceRetentionMin}`,
      );
    }
    const rankingLoss = rankingMiss / evidenceTotal;
    if (rankingLoss > cfg.rankingLossMax) {
      failures.push(`evidence lost to ranking ${rankingLoss.toFixed(4)} > ${cfg.rankingLossMax}`);
    }
  }

  const perTask = (pick) => Math.round(sum(rows, pick) / rows.length);
  const openable = sum(rows, (r) => Math.min(cfg.openFiles, r.relevantLabels));

  return {
    summary: {
      valid: anchorTotal > 0 && evidenceTotal > 0 && unscorable.length < rows.length,
      taskQueries: rows.length,
      openFilesPerTask: cfg.openFiles,
      taskBudget: cfg.taskBudget,
      agentBudget: cfg.agentBudget,
      chainCeiling,
      callsPerTask: Number((sum(rows, (r) => r.calls) / rows.length).toFixed(2)),
      tokensPerTask: {
        anchored: perTask((r) => r.anchoredTokens),
        plain: perTask((r) => r.plainTokens),
        taskCapsuleOnly: perTask((r) => r.taskTokens),
      },
      labeledFilesOpened: ratio(
        sum(rows, (r) => r.relevantOpened),
        openable,
      ),
      anchorRetention: {
        anchored: anchoredRetention,
        plain: plainRetention,
        answerableAnchors: anchorTotal,
      },
      evidenceRetention: {
        labels: evidenceTotal,
        anchored: anchoredEvidence,
        plain: plainEvidence,
        // Packing only ever sees labels whose file was opened; say so instead
        // of implying the other labels passed a packing check.
        labelsReachingPacking: evidenceTotal - rankingMiss,
        keptByPackingAnchored: evidenceTotal - rankingMiss - anchoredPackingMiss,
        lostToRanking: rankingMiss,
        lostToRankingRatio: ratio(rankingMiss, evidenceTotal),
        lostToRankingCauses: evidenceCauses(rows),
        lostToPackingAnchored: anchoredPackingMiss,
        lostToPackingPlain: plainPackingMiss,
      },
      unscorableRows: unscorable,
    },
    failures,
  };
}
