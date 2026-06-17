import * as vscode from "vscode";
import type { AiModelTier, AiSelection, SeverityThreshold } from "mp-sentinel-extension-core";

const SECTION = "mpSentinel";

export interface CliSettings {
  command: string;
  baseArgs: string[];
  timeoutMs: number;
}

export interface ReviewSettings {
  targetBranch?: string;
  includeInfoSeverity: boolean;
  /** Default base branch for branch-diff review. */
  compareBranch: string;
  /** Directory (workspace-relative) for branch-diff markdown reports. */
  branchReportDirectory: string;
  /** Severity floor for branch-diff FAIL. */
  branchSeverityThreshold: SeverityThreshold;
}

function asSeverityThreshold(value: string | undefined): SeverityThreshold {
  return value === "CRITICAL" || value === "WARNING" ? value : "INFO";
}

export interface ExtensionSettings {
  cli: CliSettings;
  ai: AiSelection;
  review: ReviewSettings;
  skillsAgents: string[];
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value : undefined;
}

/** Reads workspace/user configuration for the given resource scope. */
export function readSettings(scope?: vscode.Uri): ExtensionSettings {
  const cfg = vscode.workspace.getConfiguration(SECTION, scope ?? null);

  const ai: AiSelection = {};
  const provider = nonEmpty(cfg.get<string>("ai.provider"));
  const model = nonEmpty(cfg.get<string>("ai.model"));
  const modelTier = nonEmpty(cfg.get<string>("ai.modelTier")) as AiModelTier | undefined;
  if (provider) ai.provider = provider;
  if (model) ai.model = model;
  if (modelTier) ai.modelTier = modelTier;
  // Optional non-secret provider settings (never credentials).
  const anthropicBaseUrl = nonEmpty(cfg.get<string>("ai.anthropicBaseUrl"));
  const openrouterSiteUrl = nonEmpty(cfg.get<string>("ai.openrouterSiteUrl"));
  const openrouterAppName = nonEmpty(cfg.get<string>("ai.openrouterAppName"));
  if (anthropicBaseUrl) ai.anthropicBaseUrl = anthropicBaseUrl;
  if (openrouterSiteUrl) ai.openrouterSiteUrl = openrouterSiteUrl;
  if (openrouterAppName) ai.openrouterAppName = openrouterAppName;

  const review: ReviewSettings = {
    includeInfoSeverity: cfg.get<boolean>("review.includeInfoSeverity", true),
    compareBranch: cfg.get<string>("review.compareBranch", "origin/main") || "origin/main",
    branchReportDirectory: cfg.get<string>("review.branchReportDirectory", "reports") || "reports",
    branchSeverityThreshold: asSeverityThreshold(cfg.get<string>("review.branchSeverityThreshold")),
  };
  const targetBranch = nonEmpty(cfg.get<string>("review.targetBranch"));
  if (targetBranch) review.targetBranch = targetBranch;

  return {
    cli: {
      command: cfg.get<string>("cli.command", "npx"),
      baseArgs: cfg.get<string[]>("cli.baseArgs", ["mp-sentinel"]),
      timeoutMs: cfg.get<number>("cli.timeoutMs", 120000),
    },
    ai,
    review,
    skillsAgents: cfg.get<string[]>("skills.agents", ["claude"]),
  };
}
