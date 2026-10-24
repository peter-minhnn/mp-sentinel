/**
 * Types for the chain scoring module. The implementation is plain ESM
 * (`chain-metrics.mjs`) so the bench script can run it without a build step;
 * this declaration lets the regression test import the same module.
 */

export interface ChainRow {
  query: string;
  opened: string[];
  calls: number;
  relevantLabels: number;
  relevantOpened: number;
  taskTokens: number;
  anchoredTokens: number;
  plainTokens: number;
  answerableAnchors: number;
  anchoredKept: number;
  plainKept: number;
  evidenceTotal: number;
  evidenceRankingMiss: number;
  evidenceAnchoredPackingMiss: number;
  evidencePlainPackingMiss: number;
}

export interface ChainConfig {
  taskBudget: number;
  agentBudget: number;
  openFiles: number;
  anchorRetentionMin: number;
  evidenceRetentionMin: number;
  rankingLossMax: number;
}

export interface UnscorableRow {
  query: string;
  reason: "no-files" | "no-evidence-labels" | "no-answerable-anchors";
}

export interface ChainSummary {
  valid: boolean;
  taskQueries: number;
  reason?: string;
  openFilesPerTask?: number;
  taskBudget?: number;
  agentBudget?: number;
  chainCeiling?: number;
  callsPerTask?: number;
  tokensPerTask?: { anchored: number; plain: number; taskCapsuleOnly: number };
  labeledFilesOpened?: number | null;
  anchorRetention?: {
    anchored: number | null;
    plain: number | null;
    answerableAnchors: number;
  };
  evidenceRetention?: {
    labels: number;
    anchored: number | null;
    plain: number | null;
    lostToRanking: number;
    lostToRankingRatio: number | null;
    lostToPackingAnchored: number;
    lostToPackingPlain: number;
  };
  unscorableRows?: UnscorableRow[];
}

export type LossCause = "not-candidate" | "outside-top-n" | "dropped-by-task-budget" | "unknown";

export declare const LOSS_CAUSES: LossCause[];

export declare function hasRankingData(payload: unknown): boolean;

export declare function classifyMissingFile(input: {
  rank: number;
  truncated: boolean;
  hasRanking: boolean;
  openFiles: number;
}): LossCause;

export declare const CHAIN_DEFAULTS: ChainConfig;

export declare function summarizeChain(
  rows: ChainRow[],
  config?: Partial<ChainConfig>,
): { summary: ChainSummary; failures: string[] };
