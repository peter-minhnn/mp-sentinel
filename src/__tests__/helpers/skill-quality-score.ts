/**
 * Internal quality scoring for the create-skills benchmark corpus.
 *
 * Computes deterministic usefulness metrics over GeneratedContent so each
 * archetype fixture can assert quality numerically instead of via brittle
 * full-output snapshots:
 *
 * - falsePositiveCount        — forbidden stack markers present in output
 * - missingCriticalSignalCount — expected signals absent from output
 * - commandCorrectness        — all rendered commands match the package manager
 * - referenceCoverage         — expected modules visible in module map/routing
 * - instructionDensity        — actionable bullets per 1000 chars
 *
 * Test-only: not exported from src, no CLI flag.
 */

import type { GeneratedContent } from "../../services/skills-generator/content.js";

export interface ArchetypeExpectations {
  packageManager: "npm" | "pnpm" | "yarn" | "bun";
  /** Stack-mismatched advice that must NOT appear anywhere */
  forbiddenMarkers: string[];
  /** Critical signals that MUST appear somewhere in the generated sections */
  requiredSignals: string[];
  /** Module map entries expected for reference coverage (optional) */
  expectedModules?: string[];
}

export interface SkillQualityScore {
  falsePositiveCount: number;
  missingCriticalSignalCount: number;
  missingSignals: string[];
  foundForbidden: string[];
  commandCorrectness: boolean;
  commandViolations: string[];
  referenceCoverage: number;
  instructionDensity: number;
  totalChars: number;
}

const EXEC_PREFIXES: ReadonlyArray<readonly [pm: string, prefix: string]> = [
  ["npm", "npx mp-sentinel"],
  ["pnpm", "pnpm exec mp-sentinel"],
  ["pnpm", "pnpm dlx mp-sentinel"],
  ["yarn", "yarn dlx mp-sentinel"],
  ["bun", "bunx --bun mp-sentinel"],
];

const COMMAND_LINE_PREFIX = "^[\\s>*-]*(?:\\d+\\.\\s*)?`?";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function allSectionText(content: GeneratedContent): string {
  return Object.values(content.sections)
    .filter((s): s is string => typeof s === "string")
    .join("\n");
}

/** Sections an agent actually consumes as instructions (density basis). */
function instructionText(content: GeneratedContent): string {
  const s = content.sections;
  return [
    s.agentWorkflow,
    s.projectRules,
    s.detectedConventions,
    s.firstFilesToRead,
    s.commonChangePaths,
    s.languageRules,
    s.profileRules,
  ]
    .filter(Boolean)
    .join("\n");
}

function findCommandViolations(text: string, pm: string): string[] {
  const violations: string[] = [];
  const lines = text.split("\n");

  for (const [prefixPm, prefix] of EXEC_PREFIXES) {
    if (prefixPm === pm) continue;
    const re = new RegExp(`${COMMAND_LINE_PREFIX}${escapeRe(prefix)}`);
    if (lines.some((line) => re.test(line))) {
      violations.push(prefix);
    }
  }

  const runRe = new RegExp(`${COMMAND_LINE_PREFIX}(npm|pnpm|yarn|bun) (run |test\\b)`);
  for (const line of lines) {
    const match = runRe.exec(line);
    if (match && match[1] !== pm) {
      violations.push(`${match[1]} ${match[2]!.trim()}`);
      break;
    }
  }

  return violations;
}

export function computeSkillQualityScore(
  content: GeneratedContent,
  expectations: ArchetypeExpectations,
): SkillQualityScore {
  const text = allSectionText(content);

  const foundForbidden = expectations.forbiddenMarkers.filter((m) => text.includes(m));
  const missingSignals = expectations.requiredSignals.filter((s) => !text.includes(s));

  const commandViolations = findCommandViolations(text, expectations.packageManager);

  const expectedModules = expectations.expectedModules ?? [];
  const navigable = `${content.sections.modules}\n${content.sections.codebaseMap}\n${content.sections.referenceRouting}`;
  const covered = expectedModules.filter((m) => navigable.includes(m)).length;
  const referenceCoverage = expectedModules.length === 0 ? 1 : covered / expectedModules.length;

  const instr = instructionText(content);
  const bullets = instr.split("\n").filter((l) => l.trim().startsWith("- ")).length;
  const instructionDensity = instr.length === 0 ? 0 : bullets / (instr.length / 1000);

  return {
    falsePositiveCount: foundForbidden.length,
    missingCriticalSignalCount: missingSignals.length,
    missingSignals,
    foundForbidden,
    commandCorrectness: commandViolations.length === 0,
    commandViolations,
    referenceCoverage,
    instructionDensity,
    totalChars: text.length,
  };
}
