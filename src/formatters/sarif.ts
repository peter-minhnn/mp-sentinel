/**
 * SARIF 2.1.0 formatter — produces output consumable by GitHub Code Scanning,
 * GitLab Security Dashboard, SonarQube, and other static-analysis viewers.
 *
 * Spec: https://docs.oasis-open.org/sarif/sarif/v2.1.0/os/sarif-v2.1.0-os.html
 *
 * Only the subset of SARIF we need is modeled here — runs[0] contains the
 * mp-sentinel tool driver and one result per AuditIssue. Cached issues are
 * tagged via `properties.cached: true`. Tool driver `rules[]` lists every
 * distinct category encountered so consumers can group by category.
 */

import type { AuditIssue, FileAuditResult, ReviewReport } from "../types/index.js";
import { getToolVersion } from "../utils/version.js";

const SARIF_VERSION = "2.1.0" as const;
const SARIF_SCHEMA =
  "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/Schemata/sarif-schema-2.1.0.json";

interface SarifMessage {
  text: string;
}

interface SarifLocation {
  physicalLocation: {
    artifactLocation: { uri: string };
    region: { startLine: number };
  };
}

interface SarifResult {
  ruleId: string;
  level: "error" | "warning" | "note";
  message: SarifMessage;
  locations: SarifLocation[];
  properties: {
    category?: string;
    confidence?: string;
    cached?: boolean;
    evidence?: string;
    suggestion?: string;
  };
}

interface SarifRule {
  id: string;
  name: string;
  shortDescription: SarifMessage;
  fullDescription: SarifMessage;
  defaultConfiguration?: { level: "error" | "warning" | "note" };
  properties?: { tags?: string[] };
}

interface SarifRun {
  tool: {
    driver: {
      name: string;
      version: string;
      informationUri: string;
      rules: SarifRule[];
    };
  };
  results: SarifResult[];
  invocations: Array<{
    executionSuccessful: boolean;
    endTimeUtc: string;
  }>;
}

export interface SarifLog {
  $schema: typeof SARIF_SCHEMA;
  version: typeof SARIF_VERSION;
  runs: SarifRun[];
}

const SEVERITY_TO_LEVEL = {
  CRITICAL: "error",
  WARNING: "warning",
  INFO: "note",
} as const;

const ruleIdFor = (issue: AuditIssue): string => {
  // Stable, human-readable rule id. Falls back to "general" when the AI
  // doesn't tag a category.
  const category = issue.category ?? "general";
  return `mp-sentinel/${category}`;
};

const buildResult = (entry: FileAuditResult, issue: AuditIssue): SarifResult => {
  const result: SarifResult = {
    ruleId: ruleIdFor(issue),
    level: SEVERITY_TO_LEVEL[issue.severity],
    message: { text: issue.message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: entry.filePath },
          // SARIF requires startLine ≥ 1
          region: { startLine: Math.max(1, issue.line) },
        },
      },
    ],
    properties: {},
  };
  if (issue.category) result.properties.category = issue.category;
  if (issue.confidence) result.properties.confidence = issue.confidence;
  if (entry.cached) result.properties.cached = true;
  if (issue.evidence) result.properties.evidence = issue.evidence;
  if (issue.suggestion) result.properties.suggestion = issue.suggestion;
  return result;
};

const buildRunErrorResult = (filePath: string, message: string): SarifResult => ({
  ruleId: "mp-sentinel/runtime-error",
  level: "error",
  message: { text: message },
  locations: [
    {
      physicalLocation: {
        artifactLocation: { uri: filePath },
        region: { startLine: 1 },
      },
    },
  ],
  properties: { category: "runtime-error" },
});

const buildRules = (results: SarifResult[]): SarifRule[] => {
  const ruleIds = new Set<string>();
  for (const r of results) ruleIds.add(r.ruleId);

  return [...ruleIds].sort().map((id): SarifRule => {
    const category = id.startsWith("mp-sentinel/") ? id.slice("mp-sentinel/".length) : id;
    return {
      id,
      name: category,
      shortDescription: { text: `mp-sentinel: ${category}` },
      fullDescription: {
        text: `Findings categorized as "${category}" by mp-sentinel.`,
      },
      properties: { tags: [category] },
    };
  });
};

/**
 * Convert a ReviewReport into a SARIF 2.1.0 log. Pure — no I/O.
 */
export const formatSarifReport = (report: ReviewReport): SarifLog => {
  const results: SarifResult[] = [];
  for (const entry of report.results) {
    if (entry.result.status === "ERROR") {
      results.push(
        buildRunErrorResult(entry.filePath, entry.result.message ?? "Runtime error during review"),
      );
      continue;
    }
    for (const issue of entry.result.issues ?? []) {
      results.push(buildResult(entry, issue));
    }
  }

  for (const err of report.errors) {
    results.push(buildRunErrorResult("(global)", err));
  }

  const run: SarifRun = {
    tool: {
      driver: {
        name: "mp-sentinel",
        version: getToolVersion(),
        informationUri: "https://github.com/peter-minhnn/mp-sentinel",
        rules: buildRules(results),
      },
    },
    results,
    invocations: [
      {
        executionSuccessful: report.status !== "ERROR",
        endTimeUtc: report.generatedAt,
      },
    ],
  };

  return {
    $schema: SARIF_SCHEMA,
    version: SARIF_VERSION,
    runs: [run],
  };
};

/**
 * Serialize the SARIF log to a stable, parser-friendly JSON string.
 */
export const stringifySarif = (report: ReviewReport): string =>
  JSON.stringify(formatSarifReport(report), null, 2);
