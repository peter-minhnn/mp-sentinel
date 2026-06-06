/**
 * Review Context Builder - generates impact-aware review context from source index
 */

import type {
  SourceIndex,
  SourceIndexFile,
  ReviewContextMetadata,
  ReviewIntelligenceSignal,
  EvidenceSummary,
  RelationType,
  SkillKnowledgeBase,
} from "../../types/index.js";
import { detectProfile, type SkillProfile } from "../skills-generator/profile.js";
import { buildSkillKnowledgeBase } from "../skills-generator/knowledge-base.js";
import { log } from "../../utils/logger.js";
import { quoteCliArg } from "./query.js";

const INDEX_CONTEXT_MAX_CHARS = 12000;

// Call-impact caps (schema 1.4 call edges). Conservative so the section
// stays compact even on hot files.
const MAX_CALL_SITES_PER_CALLER = 2;
const MAX_CALL_IMPACT_SECTION_LINES = 8;

/** A call site in another file that textually matches a changed file's export. */
interface CallSiteEvidence {
  /** Exported symbol name from the changed file that matched. */
  symbol: string;
  /** Callee text as written at the call site (may be `obj.symbol`). */
  callee: string;
  line: number;
  inSymbol?: string | undefined;
}

/** Caller files (with matched call sites) per changed file. */
type CallerMatches = Map<string, Map<string, CallSiteEvidence[]>>;

/** Exported symbol names of a file, for textual call matching. */
function getExportedNames(file: SourceIndexFile): Set<string> {
  const names = new Set<string>();
  if (file.exportedSymbols) {
    for (const name of file.exportedSymbols) names.add(name);
  } else {
    for (const exp of file.exports) {
      for (const name of exp.names) names.add(name);
    }
  }
  names.delete("default");
  names.delete("");
  return names;
}

/**
 * Match changed files' exported symbols against other files' call edges
 * (schema 1.4 `calls`). Matching is textual/candidate-based: a plain call
 * matches the exported name exactly; a member call matches a trailing
 * `.name`. Old caches without `calls` simply produce no matches.
 */
function computeCallerMatches(
  index: SourceIndex,
  fileIndexMap: Map<string, SourceIndexFile>,
  changedPaths: string[],
): CallerMatches {
  const matches: CallerMatches = new Map();

  for (const changedPath of changedPaths) {
    const changedFile = fileIndexMap.get(changedPath);
    if (!changedFile) continue;
    const exportedNames = getExportedNames(changedFile);
    if (exportedNames.size === 0) continue;

    const callers = new Map<string, CallSiteEvidence[]>();
    for (const other of index.files) {
      if (other.path === changedPath || !other.calls) continue;
      for (const call of other.calls) {
        const dotIndex = call.callee.lastIndexOf(".");
        const tail = dotIndex === -1 ? call.callee : call.callee.slice(dotIndex + 1);
        if (!exportedNames.has(tail)) continue;
        const sites = callers.get(other.path) ?? [];
        sites.push({
          symbol: tail,
          callee: call.callee,
          line: call.line,
          inSymbol: call.inSymbol,
        });
        callers.set(other.path, sites);
      }
    }
    if (callers.size > 0) {
      matches.set(changedPath, callers);
    }
  }

  return matches;
}

/** Caller file paths ranked by matched-call-site count (desc), then path. */
function rankCallerFiles(callers: Map<string, CallSiteEvidence[]>): string[] {
  return [...callers.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([path]) => path);
}

/** One compact evidence line per caller file, capped per caller. */
function formatCallSites(sites: CallSiteEvidence[], callerPath: string): string {
  const shown = sites
    .slice(0, MAX_CALL_SITES_PER_CALLER)
    .map((s) => `${s.callee} @ ${callerPath}:${s.line}${s.inSymbol ? ` (in ${s.inSymbol})` : ""}`)
    .join(", ");
  const more = sites.length > MAX_CALL_SITES_PER_CALLER ? ` +${sites.length - 2} more` : "";
  return `${shown}${more}`;
}

/**
 * Profile-specific review pitfalls (concise, 3-5 bullets each)
 */
export function getProfileReviewPitfalls(profile: SkillProfile): string[] {
  switch (profile) {
    case "cli-tooling":
      return [
        "Exit codes are a contract - never change 0/1/2 semantics without a breaking-change note",
        "Diff-first review - do not send full file content when diff + context is sufficient",
        "Keep CLI parsing separate - argument parsing belongs in src/cli/, not inside command implementations",
        "No business logic in src/index.ts - entry files should only route, never contain core logic",
      ];
    case "node-service":
      return [
        "Handler purity - ensure request handlers are stateless and side-effect free",
        "Error middleware - centralized error handling with proper status codes",
        "Environment validation - validate required env vars on startup, fail fast",
        "Async boundaries - avoid mixing async/await and .then() in same code path",
        "Health checks - implement /health and /ready endpoints for orchestration",
      ];
    case "react-next":
      return [
        "Server/Client boundary - respect 'use client' directive, avoid client logic in server components",
        "Data fetching colocation - fetch data as close as possible to where it's used",
        "next/image optimization - always use next/image for external images with proper domains",
        "Bundle vigilance - avoid large dependencies in client bundles, use dynamic imports",
      ];
    case "react-spa":
      return [
        "Route-level code splitting - lazy-load route components to keep the initial bundle small",
        "Server state belongs in a data library (React Query/SWR), not duplicated in component state",
        "Hooks discipline - complete dependency arrays, stable keys in render loops",
        "Bundle vigilance - avoid large dependencies in the client bundle, use dynamic imports",
      ];
    case "library":
      return [
        "Public API surface - consider semver impact of every exported symbol",
        "Type definitions - ensure .d.ts files are accurate and complete",
        "Peer dependencies - declare peerDependencies, not dependencies, for react, typescript, etc.",
        "Tree-shakeability - avoid side effects in module initialization, use __esModule interop",
      ];
    default:
      return [
        "Follow project-specific rules from .mp-sentinelrc.json",
        "Prioritize security and error handling",
        "Keep code simple and testable",
      ];
  }
}

/**
 * Build review context from source index with impact-aware ranking
 *
 * Priority order:
 * 1. Changed files (always first, marked as "(changed)")
 * 2. Direct imports (files that changed file depends on)
 * 3. Direct dependents (files that import changed file)
 * 4. Hub files (most-imported files in project) — only if budget remains
 *
 * @param index - Source index (null returns empty context)
 * @param changedFiles - Array of { path: string } for changed files
 * @param options - Configuration options
 * @param options.maxRelatedFiles - Cap per changed file for imports/dependents (default 3)
 * @param options.budgetChars - Maximum character budget (default 12000)
 * @returns Context string and metadata
 */
export async function buildReviewContext(
  index: SourceIndex | null,
  changedFiles: Array<{ path: string }>,
  options: {
    maxRelatedFiles?: number;
    budgetChars?: number;
  } = {},
): Promise<{ context: string; metadata: ReviewContextMetadata }> {
  const maxRelatedFiles = options.maxRelatedFiles ?? 3;
  const budgetChars = options.budgetChars ?? INDEX_CONTEXT_MAX_CHARS;

  // Early return for missing index
  if (!index) {
    return {
      context: "",
      metadata: {
        profile: "library",
        relatedFileCount: 0,
        relationTypes: [],
        includedFiles: [],
        truncated: false,
        budgetChars,
      },
    };
  }

  // Detect profile
  const profile = detectProfile(index);

  // Validate index parse health
  const totalFiles = index.files.length;
  const filesWithErrors = index.files.filter(
    (f) => f.parseErrors && f.parseErrors.length > 0,
  ).length;
  if (totalFiles > 0 && filesWithErrors / totalFiles > 0.5) {
    log.warning(
      `Review context: too many parse errors (${filesWithErrors}/${totalFiles}), skipping index context`,
    );
    return {
      context: "",
      metadata: {
        profile,
        relatedFileCount: 0,
        relationTypes: [],
        includedFiles: [],
        truncated: false,
        budgetChars,
      },
    };
  }

  // Build file lookup maps
  const fileIndexMap = new Map<string, SourceIndexFile>();
  for (const file of index.files) {
    fileIndexMap.set(file.path, file);
  }

  const changedPaths = changedFiles.map((f) => f.path);
  const seen = new Set<string>();
  const orderedPaths: string[] = [];
  const relationTypesMap = new Map<string, RelationType[]>();

  // Tier 1: Changed files first
  for (const path of changedPaths) {
    if (fileIndexMap.has(path) && !seen.has(path)) {
      orderedPaths.push(path);
      seen.add(path);
      const types = relationTypesMap.get(path) ?? [];
      relationTypesMap.set(path, [...types, "changed"]);
    }
  }

  // Tier 2 & 3: Direct imports and dependents for each changed file
  for (const changedPath of changedPaths) {
    const file = fileIndexMap.get(changedPath);
    if (!file) continue;

    // Direct imports (Tier 2)
    let addedImports = 0;
    if (file.importsFrom?.length) {
      for (const importPath of file.importsFrom) {
        if (addedImports >= maxRelatedFiles) break;
        if (fileIndexMap.has(importPath) && !seen.has(importPath)) {
          orderedPaths.push(importPath);
          seen.add(importPath);
          addedImports++;
          const types = relationTypesMap.get(importPath) ?? [];
          relationTypesMap.set(importPath, [...types, "import"]);
        }
      }
    }

    // Direct dependents (Tier 3)
    let addedDependents = 0;
    if (file.importedBy?.length) {
      for (const dependentPath of file.importedBy) {
        if (addedDependents >= maxRelatedFiles) break;
        if (fileIndexMap.has(dependentPath) && !seen.has(dependentPath)) {
          orderedPaths.push(dependentPath);
          seen.add(dependentPath);
          addedDependents++;
          const types = relationTypesMap.get(dependentPath) ?? [];
          relationTypesMap.set(dependentPath, [...types, "dependent"]);
        }
      }
    }
  }

  // Tier 3.5: Caller files from call edges (schema 1.4). Candidate/textual
  // matches of changed files' exported symbols against other files' calls.
  // Files already included as imports/dependents keep their slot but gain
  // the "caller" tag; new caller files rank before hub files.
  const callerMatches = computeCallerMatches(index, fileIndexMap, changedPaths);
  for (const changedPath of changedPaths) {
    const callers = callerMatches.get(changedPath);
    if (!callers) continue;
    let addedCallers = 0;
    for (const callerPath of rankCallerFiles(callers)) {
      if (!fileIndexMap.has(callerPath)) continue;
      if (seen.has(callerPath)) {
        // Already included (e.g. as a direct dependent) -- tag, don't re-add.
        const types = relationTypesMap.get(callerPath) ?? [];
        if (!types.includes("caller")) {
          relationTypesMap.set(callerPath, [...types, "caller"]);
        }
        continue;
      }
      if (addedCallers >= maxRelatedFiles) continue;
      orderedPaths.push(callerPath);
      seen.add(callerPath);
      addedCallers++;
      const types = relationTypesMap.get(callerPath) ?? [];
      relationTypesMap.set(callerPath, [...types, "caller"]);
    }
  }

  // Tier 4: Hub files (most-imported) if budget remains
  // We define hub files as those importedBy >= 3 and not already included
  if (orderedPaths.length < totalFiles) {
    const hubCandidates: Array<{ path: string; popularity: number }> = [];
    for (const file of index.files) {
      if (seen.has(file.path)) continue;
      const importedByCount = file.importedBy?.length ?? 0;
      if (importedByCount >= 3) {
        hubCandidates.push({ path: file.path, popularity: importedByCount });
      }
    }
    // Sort by popularity (descending), path (ascending) tie-breaker
    hubCandidates.sort((a, b) => b.popularity - a.popularity || a.path.localeCompare(b.path));
    // Add as many as fit within remaining budget (but cap to avoid bloat)
    const maxHubs = Math.min(5, totalFiles - orderedPaths.length);
    for (let i = 0; i < Math.min(maxHubs, hubCandidates.length); i++) {
      const candidate = hubCandidates[i];
      if (!candidate) continue;
      orderedPaths.push(candidate.path);
      seen.add(candidate.path);
      const types = relationTypesMap.get(candidate.path) ?? [];
      relationTypesMap.set(candidate.path, [...types, "hub"]);
    }
  }

  if (orderedPaths.length === 0) {
    return {
      context: "",
      metadata: {
        profile,
        relatedFileCount: 0,
        relationTypes: [],
        includedFiles: [],
        truncated: false,
        budgetChars,
      },
    };
  }

  // Build context output incrementally respecting budget
  const lines: string[] = [];
  lines.push("=== Source Index Context ===");
  lines.push(
    `Project: ${index.project.packageName || "unknown"} v${index.project.packageVersion || "n/a"}`,
  );
  lines.push(`Frameworks: ${index.project.detectedFrameworks.join(", ") || "none"}`);
  if (Object.keys(index.project.dependencies).length > 0) {
    const depList = Object.entries(index.project.dependencies)
      .slice(0, 10)
      .map(([name, version]) => `${name}@${version}`)
      .join(", ");
    lines.push(
      `Key dependencies: ${depList}${Object.keys(index.project.dependencies).length > 10 ? "..." : ""}`,
    );
  }
  lines.push("");

  // Add profile-specific pitfalls section (3-5 bullets)
  const pitfalls = getProfileReviewPitfalls(profile);
  lines.push("**Profile Review Pitfalls:**");
  for (const pitfall of pitfalls) {
    lines.push(`- ${pitfall}`);
  }
  lines.push("");

  lines.push(`Relevant files (diff + dependencies):`);

  const relevantFiles = orderedPaths
    .map((p) => fileIndexMap.get(p))
    .filter((f): f is NonNullable<typeof f> => f !== undefined);

  const includedFiles: string[] = [];
  const relationTypesList: RelationType[] = [];
  let truncated = false;

  // Calculate current size after header
  let currentSize = lines.join("\n").length;

  // Add files one by one, checking budget before each addition
  for (const file of relevantFiles) {
    const isDiff = changedPaths.includes(file.path);
    const types = relationTypesMap.get(file.path) ?? [];
    const typeTags = types.length > 0 ? ` [${types.join(", ")}]` : "";

    // Build file section
    const fileLines: string[] = [];
    fileLines.push(`\nFile: ${file.path}${isDiff ? " (changed)" : ""}${typeTags}`);
    fileLines.push(`  Language: ${file.language}`);

    if (file.symbols.length > 0) {
      const symbolSummary = file.symbols
        .slice(0, 15)
        .map(
          (symbol) =>
            `${symbol.type} ${symbol.name}${symbol.parent ? ` (in ${symbol.parent})` : ""}`,
        )
        .join(", ");
      fileLines.push(`  Symbols: ${symbolSummary}${file.symbols.length > 15 ? "..." : ""}`);
    }

    if (file.importsFrom && file.importsFrom.length > 0) {
      const imports = file.importsFrom.slice(0, 8).join(", ");
      fileLines.push(`  Imports from: ${imports}${file.importsFrom.length > 8 ? "..." : ""}`);
    }

    if (file.importedBy && file.importedBy.length > 0) {
      const importedBy = file.importedBy.slice(0, 8).join(", ");
      fileLines.push(`  Imported by: ${importedBy}${file.importedBy.length > 8 ? "..." : ""}`);
    }

    if (file.exportedSymbols && file.exportedSymbols.length > 0) {
      const exports = file.exportedSymbols.slice(0, 10).join(", ");
      fileLines.push(`  Exports: ${exports}${file.exportedSymbols.length > 10 ? "..." : ""}`);
    }

    if (file.parseErrors && file.parseErrors.length > 0) {
      fileLines.push(`  Parse errors: ${file.parseErrors.join("; ")}`);
    }

    const fileSection = fileLines.join("\n");
    const projectedTotal = currentSize + fileSection.length + 50; // buffer for truncation marker and end marker

    if (projectedTotal > budgetChars) {
      truncated = true;
      break;
    }

    lines.push(fileSection);
    includedFiles.push(file.path);
    relationTypesList.push(...types);
    currentSize += fileSection.length;
  }

  lines.push("\n=== End Source Index Context ===");
  let context = lines.join("\n");

  // Apply truncation marker if we stopped early
  if (truncated) {
    const truncatePoint = budgetChars - 50;
    if (context.length > truncatePoint) {
      context = context.slice(0, truncatePoint) + "\n[Source index context truncated to budget]";
    }
  }

  // ── Intelligence signals from shared SkillKnowledgeBase ─────────────────────
  const includedSignals: string[] = [];
  let dedupedIntelligenceSignals: ReviewIntelligenceSignal[] = [];

  // Normalize a path to its basename without extension for fuzzy matching across
  // .ts / .js extension differences (import specifiers use .js, files use .ts).
  const normalizePathKey = (p: string): string =>
    p.replace(/\.(ts|tsx|js|jsx|mjs|mts|cjs|cts)$/, "");

  const signalLines: string[] = [];
  const intelligenceSignals: ReviewIntelligenceSignal[] = [];
  let headerWritten = false;

  const writeHeader = (): void => {
    if (!headerWritten) {
      signalLines.push("\n--- Review Intelligence ---");
      headerWritten = true;
    }
  };

  let kb;
  try {
    kb = buildSkillKnowledgeBase(index);
  } catch {
    kb = null;
  }

  if (kb) {
    // Signal: Public API risk — any changed file that is a public-api entrypoint.
    // Prefer exact path match; fall back to extension-normalized matching
    // only for paths that did not match exactly.
    try {
      let publicApiChanged = changedPaths.filter((p) =>
        kb.entrypoints.some((e) => e.type === "public-api" && e.path === p),
      );
      const remainingForApi = changedPaths.filter((p) => !publicApiChanged.includes(p));
      if (remainingForApi.length > 0) {
        const fuzzyMatches = remainingForApi.filter((p) =>
          kb.entrypoints.some(
            (e) => e.type === "public-api" && normalizePathKey(e.path) === normalizePathKey(p),
          ),
        );
        publicApiChanged = publicApiChanged.concat(fuzzyMatches);
      }
      if (publicApiChanged.length > 0) {
        writeHeader();
        signalLines.push(
          `Public API Risk: ${publicApiChanged.join(", ")} - part of the public API surface; changes may be breaking.`,
        );
        includedSignals.push("public-api");
        for (const p of publicApiChanged) {
          const entrypoint =
            kb.entrypoints.find((e) => e.type === "public-api" && e.path === p) ??
            kb.entrypoints.find(
              (e) => e.type === "public-api" && normalizePathKey(e.path) === normalizePathKey(p),
            );
          intelligenceSignals.push({
            type: "public-api",
            file: p,
            reason: "File is part of the public API surface; changes may be breaking.",
            evidence: entrypoint
              ? `Re-exported from entrypoint: ${entrypoint.path}`
              : "Detected as public API entrypoint",
            confidence: "high",
          });
        }
      }
    } catch {
      // Per-signal isolation: public-api error does not suppress other signals
    }

    // Signal: Hub file blast radius — changed files that are hub files
    try {
      for (const cp of changedPaths) {
        const hubRisk = kb.risks.find((r) => r.file === cp && r.type === "hub-file");
        if (hubRisk) {
          writeHeader();
          signalLines.push(`Hub File Blast Radius: ${cp} - ${hubRisk.detail}`);
          includedSignals.push("risk");
          const importCount = hubRisk.importCount ?? 0;
          intelligenceSignals.push({
            type: "risk",
            file: cp,
            reason: `File has high blast radius - imported by ${importCount} other file(s).`,
            evidence: `importedBy count: ${importCount}`,
            confidence: importCount >= 5 ? "high" : importCount >= 3 ? "medium" : "low",
          });
        }
      }
    } catch {
      // Per-signal isolation: risk error does not suppress other signals
    }

    // Signal: Test gaps — changed files without associated tests
    try {
      const changedWithNoTests = changedPaths.filter((p) =>
        kb.testing.testGaps.some((g) => g.sourceFile === p),
      );
      if (changedWithNoTests.length > 0) {
        writeHeader();
        signalLines.push(
          `Test Coverage Gap: ${changedWithNoTests.length} of ${changedPaths.length} changed file(s) have no associated tests:`,
        );
        for (const p of changedWithNoTests.slice(0, 5)) {
          signalLines.push(`  - ${p}`);
        }
        if (changedWithNoTests.length > 5) {
          signalLines.push(`  ... and ${changedWithNoTests.length - 5} more`);
        }
        includedSignals.push("test-gap");
        for (const p of changedWithNoTests) {
          const gap = kb.testing.testGaps.find((g) => g.sourceFile === p);
          intelligenceSignals.push({
            type: "test-gap",
            file: p,
            reason: `No associated test file found for ${p}.`,
            evidence: gap ? `Reason: ${gap.reason}` : "No test association in index",
            confidence: "medium",
          });
        }
      }
    } catch {
      // Per-signal isolation: test-gap error does not suppress other signals
    }

    // Signal: Dependency usage — top deps used by changed files
    try {
      const changedSet = new Set(changedPaths);
      const relevantDeps = kb.dependencies.filter((d) => d.files.some((f) => changedSet.has(f)));
      if (relevantDeps.length > 0) {
        writeHeader();
        const depList = relevantDeps
          .slice(0, 5)
          .map((d) => `${d.packageName}@${d.version}`)
          .join(", ");
        signalLines.push(
          `Key Dependencies Used: ${depList}${relevantDeps.length > 5 ? "..." : ""}`,
        );
        includedSignals.push("dependency");
        for (const dep of relevantDeps.slice(0, 5)) {
          const filesUsingDep = dep.files.filter((f) => changedSet.has(f));
          for (const f of filesUsingDep) {
            intelligenceSignals.push({
              type: "dependency",
              file: f,
              reason: `Changed file imports package \`${dep.packageName}\`.`,
              evidence: `Package: ${dep.packageName}@${dep.version}`,
              confidence: "medium",
            });
          }
        }
      }
    } catch {
      // Per-signal isolation: dependency error does not suppress other signals
    }
  }

  // Signal: Call impact -- changed files whose exported symbols are called
  // elsewhere (schema 1.4 call edges; textual/candidate matching). Built as
  // its own compact section so it can be omitted independently when the
  // budget is tight. Old caches without `calls` produce no matches.
  const callImpactLines: string[] = [];
  const topCallerFiles: string[] = [];
  try {
    if (callerMatches.size > 0) {
      callImpactLines.push("\n--- Call Impact (candidate callers - textual matches) ---");
      for (const [changedPath, callers] of callerMatches) {
        const rankedCallers = rankCallerFiles(callers);
        for (const callerPath of rankedCallers.slice(0, maxRelatedFiles)) {
          if (callImpactLines.length > MAX_CALL_IMPACT_SECTION_LINES) break;
          const sites = callers.get(callerPath) ?? [];
          callImpactLines.push(`${changedPath}: ${formatCallSites(sites, callerPath)}`);
          if (!topCallerFiles.includes(callerPath)) topCallerFiles.push(callerPath);
        }

        includedSignals.push("call-impact");
        for (const callerPath of rankedCallers.slice(0, maxRelatedFiles)) {
          const sites = callers.get(callerPath) ?? [];
          const first = sites[0];
          if (!first) continue;
          intelligenceSignals.push({
            type: "call-impact",
            file: changedPath,
            reason:
              `Exported symbol(s) from this file are called in ${callerPath} ` +
              `(textual candidate match; verify before assuming a real caller).`,
            evidence: `${first.callee} @ ${callerPath}:${first.line} (${sites.length} call site(s))`,
            confidence: "medium",
          });
        }
      }
    }
  } catch {
    // Per-signal isolation: call-impact error does not suppress other signals
  }

  // Dedup intelligenceSignals by type + file + evidence
  dedupedIntelligenceSignals = [];
  const seenSignalKeys = new Set<string>();
  for (const s of intelligenceSignals) {
    const key = `${s.type}|${s.file}|${s.evidence}`;
    if (!seenSignalKeys.has(key)) {
      seenSignalKeys.add(key);
      dedupedIntelligenceSignals.push(s);
    }
  }

  // Append signals if they fit within remaining budget
  const signalText = signalLines.join("\n");
  if (headerWritten && context.length + signalText.length <= budgetChars) {
    context = context.replace(
      "\n=== End Source Index Context ===",
      signalText + "\n=== End Source Index Context ===",
    );
  }

  // Append the Call Impact section only when it still fits -- it is the
  // first section omitted under budget pressure, never overflowing context.
  const callImpactText = callImpactLines.join("\n");
  if (callImpactLines.length > 0 && context.length + callImpactText.length <= budgetChars) {
    context = context.replace(
      "\n=== End Source Index Context ===",
      callImpactText + "\n=== End Source Index Context ===",
    );
  }

  // Build compact evidenceSummary from deduplicated intelligence signals
  const evidenceSummary: EvidenceSummary[] = dedupedIntelligenceSignals.map((s) => ({
    sourceFile: s.file,
    signalType: s.type,
    evidence: s.evidence,
  }));

  // Build suggested follow-up commands (v1.16.0+)
  const suggestedCommands: string[] = [];
  const seenCmds = new Set<string>();
  const addCmd = (cmd: string): void => {
    if (!seenCmds.has(cmd)) {
      seenCmds.add(cmd);
      suggestedCommands.push(cmd);
    }
  };

  // --agent-context for included files (cap 3)
  for (const file of includedFiles.slice(0, 3)) {
    addCmd(`mp-sentinel indexing --agent-context ${quoteCliArg(file)} --index-format json`);
  }

  // --agent-context for top caller files from call-impact evidence (cap 2).
  // addCmd dedupes callers already suggested via includedFiles above.
  for (const callerFile of topCallerFiles.slice(0, 2)) {
    addCmd(`mp-sentinel indexing --agent-context ${quoteCliArg(callerFile)} --index-format json`);
  }

  // --find-import for dependency evidence (cap 3)
  if (dedupedIntelligenceSignals.length > 0) {
    const importPkgs = new Set<string>();
    for (const signal of dedupedIntelligenceSignals) {
      if (signal.type === "dependency" && importPkgs.size < 3) {
        const m = signal.evidence.match(/^Package: (.+?)@/);
        const pkg = m?.[1];
        if (pkg && !importPkgs.has(pkg)) {
          importPkgs.add(pkg);
          addCmd(`mp-sentinel indexing --find-import ${quoteCliArg(pkg)} --index-format json`);
        }
      }
    }
  }

  // --find-symbol for exported symbols from included files (cap 2)
  if (includedFiles.length > 0) {
    const symNames = new Set<string>();
    for (const fp of includedFiles) {
      if (symNames.size >= 2) break;
      const f = fileIndexMap.get(fp);
      if (f?.exportedSymbols && f.exportedSymbols.length > 0) {
        for (const sym of f.exportedSymbols) {
          if (symNames.size >= 2) break;
          if (sym === "default" || sym.trim() === "") continue;
          if (!symNames.has(sym)) {
            symNames.add(sym);
            addCmd(`mp-sentinel indexing --find-symbol ${quoteCliArg(sym)} --index-format json`);
          }
        }
      }
    }
  }

  return {
    context,
    metadata: {
      profile,
      relatedFileCount: includedFiles.length,
      relationTypes: [...new Set(relationTypesList)],
      includedFiles,
      truncated,
      budgetChars,
      ...(includedSignals.length > 0 && { includedSignals: [...new Set(includedSignals)] }),
      ...(dedupedIntelligenceSignals.length > 0 && {
        intelligenceSignals: dedupedIntelligenceSignals,
      }),
      ...(evidenceSummary.length > 0 && { evidenceSummary }),
      ...(suggestedCommands.length > 0 && { suggestedCommands }),
    },
  };
}
