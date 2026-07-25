import { createHash } from "node:crypto";
import type {
  AgentAdapterId,
  CreateSkillsConfig,
  CreateSkillsPolicies,
  EnrichmentMetadata,
  SourceIndex,
  SkillOverlay,
} from "../../types/index.js";
import { DEFAULT_CREATE_SKILLS_POLICIES } from "../../types/index.js";
import { detectInstructionFiles } from "./instruction-files.js";

// The marker lives in constants.ts so instruction-files.ts can use it
// without a cycle; re-exported here for existing importers.
import { METADATA_MARKER } from "./constants.js";
export { METADATA_MARKER };

/**
 * Generator version — bumped manually when the generated skill output schema
 * changes meaningfully. This is separate from the package version so that
 * skill-content changes can be tracked independently.
 *
 * Increment when: new SKILL.md sections are added, reference file set changes,
 * or the metadata header schema changes.
 *
 * v2.0.0 — Stronger Skills upgrade: added LanguageProfile, CodeStyleProfile,
 *         RulePack catalog, Clean Code Policy, File Size Policy, three new
 *         reference files (code-style.md, language-patterns.md,
 *         clean-code-checklist.md).
 *
 * v3.0.0 — Per-agent skill upgrade: every skill-capable adapter (Claude,
 *         Codex, Antigravity, Zed, Windsurf, Roo, Cline) shares the
 *         progressive-disclosure layout (lean SKILL.md + full 10-file
 *         reference set); Windsurf/Roo/Cline moved to skill folders;
 *         rule-only adapters emit concise bodies; framework rules are
 *         version-gated by manifest majors; instruction-file discovery is
 *         shared between workflow text and the fidelity hash (legacy
 *         generated rule paths excluded); output dirs pre-created so a
 *         fresh project's first generation matches its first --check.
 *
 * v3.1.0 -- NestJS support: `detectFrameworks` now recognizes the scoped
 *         `@nestjs/core`/`@nestjs/common` packages (previously only a bare
 *         `nestjs` dep, which never matched), and a dedicated NestJS rule
 *         pack codifies the standard architecture (thin controllers, DTO
 *         validation, constructor DI, module boundaries, guards/filters)
 *         with version-gated rules and controller-layering evaluators.
 */
export const GENERATOR_VERSION = "3.1.0";

/**
 * Parse the major version from a generator version string.
 * Returns 0 for unparseable strings (treat as pre-2.0.0).
 * Examples: "1.0.17" → 1, "2.0.0" → 2, "invalid" → 0
 */
export function parseGeneratorMajor(versionStr: string): number {
  const match = versionStr.match(/^(\d+)/);
  if (!match || !match[1]) return 0;
  return parseInt(match[1], 10);
}

// ── Fidelity signal detection ────────────────────────────────────────────────

// Fidelity signals share the same instruction-file discovery as the
// knowledge base (instruction-files.ts) so the workflow text and the
// --check hash can never drift apart.

export interface SkillsMetadata {
  generatorVersion: string;
  sourceIndexSchema: string;
  sourceIndexHash: string;
  agent: AgentAdapterId;
  projectName: string;
  /**
   * Deterministic hash of generation-affecting `createSkills` config
   * (policies + disableRules). Lets `--check` flag files as stale when
   * only the config changed (the source index hash alone can't see that).
   * Absent on files generated before this field existed -- treated as
   * "generated with default config".
   */
  generationConfigHash?: string;
  enrichment?: EnrichmentMetadata;
}

/** True when the given policies match the built-in defaults field-for-field. */
function isDefaultPolicies(policies: CreateSkillsPolicies): boolean {
  return (Object.keys(DEFAULT_CREATE_SKILLS_POLICIES) as Array<keyof CreateSkillsPolicies>).every(
    (key) => policies[key] === DEFAULT_CREATE_SKILLS_POLICIES[key],
  );
}

/** Project-authored rule inputs that flow into generated content. */
export interface GenerationProjectRules {
  rules?: string[] | undefined;
  ruleFiles?: string[] | undefined;
}

/**
 * Deterministic hash of the config fields that change generated output:
 * `createSkills.policies`, `createSkills.disableRules`, and the
 * project-authored `rules` / `ruleFiles` (rendered into the Project Rules
 * section). AI enrichment config is excluded -- enrichment staleness is
 * tracked by the enrichment metadata.
 *
 * Default-equivalent config (default policies, empty disableRules, no
 * project rules) is normalized to the same hash as "no config" so that
 * files generated before this field existed -- or with no
 * `.mp-sentinelrc.json` at all -- stay up-to-date until the user actually
 * changes something.
 */
export function computeGenerationConfigHash(
  createSkills?: CreateSkillsConfig,
  projectRules?: GenerationProjectRules,
  overlay?: SkillOverlay | undefined,
): string {
  const policies =
    createSkills?.policies && !isDefaultPolicies(createSkills.policies)
      ? createSkills.policies
      : undefined;
  const disableRules =
    createSkills?.disableRules && createSkills.disableRules.length > 0
      ? [...createSkills.disableRules].sort()
      : undefined;
  const rules =
    projectRules?.rules && projectRules.rules.length > 0 ? [...projectRules.rules] : undefined;
  const ruleFiles =
    projectRules?.ruleFiles && projectRules.ruleFiles.length > 0
      ? [...projectRules.ruleFiles]
      : undefined;
  const stable = {
    policies: policies
      ? sortRecord(Object.fromEntries(Object.entries(policies).map(([k, v]) => [k, String(v)])))
      : undefined,
    disableRules,
    rules,
    ruleFiles,
    // Overlay content is copied into every generated file, so editing it must
    // mark the outputs stale — otherwise `--check` reports "ok" while the
    // files on disk still carry the previous overlay.
    overlay: overlay ? { path: overlay.path, content: overlay.content } : undefined,
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex").slice(0, 16);
}

/** Hash representing "no generation-affecting config" (pre-field files). */
export const EMPTY_GENERATION_CONFIG_HASH = computeGenerationConfigHash(undefined);

/** Sort a string-keyed record into stable [key, value] pairs for hashing. */
function sortRecord(obj: Record<string, string>): [string, string][] {
  return Object.entries(obj).sort((a, b) => a[0].localeCompare(b[0]));
}

/**
 * Deterministic hash covering all fields that affect generated skill content.
 * Excludes timestamps, duration stats, and cache metadata.
 *
 * SkillKnowledgeBase (v2) is purely derived from the fields hashed below,
 * so this hash also guarantees knowledge-base staleness detection in --check.
 */
function normalizeBin(
  bin: string | Record<string, string> | undefined,
): string | [string, string][] | undefined {
  if (bin === undefined) return undefined;
  if (typeof bin === "string") return bin;
  return sortRecord(bin);
}

export function computeIndexHash(index: SourceIndex, projectRoot?: string): string {
  const stable = {
    schemaVersion: index.schemaVersion,
    manifestHash: index.manifestHash,
    project: {
      packageName: index.project.packageName,
      packageVersion: index.project.packageVersion,
      nodeEngine: index.project.nodeEngine,
      packageManager: index.project.packageManager,
      detectedFrameworks: [...index.project.detectedFrameworks].sort(),
      dependencies: sortRecord(index.project.dependencies),
      devDependencies: sortRecord(index.project.devDependencies),
      scripts: index.project.scripts ? sortRecord(index.project.scripts) : undefined,
      bin: normalizeBin(index.project.bin),
      workspaces: index.project.workspaces ? [...index.project.workspaces].sort() : undefined,
      workspacePackages: index.project.workspacePackages
        ? index.project.workspacePackages.map((p) => ({
            directory: p.directory,
            name: p.name,
            scriptNames: [...p.scriptNames].sort(),
          }))
        : undefined,
    },
    files: index.files
      .map((f) => ({
        path: f.path,
        language: f.language,
        role: f.role,
        symbols: f.symbols
          .map((s) => ({ name: s.name, type: s.type }))
          .sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type)),
        imports: f.imports
          .map((i) => ({
            source: i.source,
            kind: i.kind,
            names: [...i.names].sort(),
            typeOnly: i.typeOnly === true,
          }))
          .sort(
            (a, b) =>
              a.source.localeCompare(b.source) ||
              a.kind.localeCompare(b.kind) ||
              a.names.join(",").localeCompare(b.names.join(",")) ||
              String(a.typeOnly).localeCompare(String(b.typeOnly)),
          ),
        exports: f.exports
          .map((e) => ({
            kind: e.kind,
            names: [...e.names].sort(),
            source: e.source,
            typeOnly: e.typeOnly === true,
            isDefault: e.isDefault === true,
          }))
          .sort(
            (a, b) =>
              a.kind.localeCompare(b.kind) ||
              a.names.join(",").localeCompare(b.names.join(",")) ||
              (a.source ?? "").localeCompare(b.source ?? "") ||
              String(a.typeOnly).localeCompare(String(b.typeOnly)) ||
              String(a.isDefault).localeCompare(String(b.isDefault)),
          ),
        importsFrom: (f.importsFrom ?? []).slice().sort(),
        importedBy: (f.importedBy ?? []).slice().sort(),
        // Call edges (schema 1.4+). Hash callee/inSymbol only -- line/column
        // shifts from whitespace-only edits must not invalidate skills.
        calls: [
          ...new Set((f.calls ?? []).map((c) => `${c.callee}\u0000${c.inSymbol ?? ""}`)),
        ].sort(),
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    insights: index.insights
      ? {
          fileRoles: sortRecord(
            Object.fromEntries(
              Object.entries(index.insights.fileRoles).map(([k, v]) => [k, String(v)]),
            ),
          ),
          publicApiFiles: [...index.insights.publicApiFiles].sort(),
          testMap: sortRecord(
            Object.fromEntries(
              Object.entries(index.insights.testMap).map(([k, v]) => [k, [...v].sort().join(",")]),
            ),
          ),
          commandMap: sortRecord(
            Object.fromEntries(
              Object.entries(index.insights.commandMap).map(([k, v]) => [k, String(v)]),
            ),
          ),
          dependencyUsage: sortRecord(
            Object.fromEntries(
              Object.entries(index.insights.dependencyUsage).map(([k, v]) => [
                k,
                [...v].sort().join(","),
              ]),
            ),
          ),
          defaultExportFiles: [...index.insights.defaultExportFiles].sort(),
          reExportFiles: [...index.insights.reExportFiles].sort(),
          typeOnlyImportFiles: [...index.insights.typeOnlyImportFiles].sort(),
          dynamicImportFiles: [...index.insights.dynamicImportFiles].sort(),
        }
      : undefined,
    // Fidelity signals — instruction file presence (v1.0.16+)
    fidelity: projectRoot ? { instructionFiles: detectInstructionFiles(projectRoot) } : undefined,
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex").slice(0, 16);
}

export function renderMetadataHeader(meta: SkillsMetadata): string {
  const parts = [
    `generatorVersion=${meta.generatorVersion}`,
    `sourceIndexSchema=${meta.sourceIndexSchema}`,
    `sourceIndexHash=${meta.sourceIndexHash}`,
    `agent=${meta.agent}`,
    `projectName=${meta.projectName}`,
  ];

  if (meta.generationConfigHash) {
    parts.push(`generationConfigHash=${meta.generationConfigHash}`);
  }

  if (meta.enrichment && meta.enrichment.mode !== "none") {
    parts.push(`enrichmentMode=${meta.enrichment.mode}`);
    parts.push(`enrichmentProvider=${meta.enrichment.provider}`);
    parts.push(`enrichmentModel=${meta.enrichment.model}`);
    parts.push(`enrichmentPromptVersion=${meta.enrichment.promptVersion}`);
    parts.push(`enrichmentInputHash=${meta.enrichment.inputHash}`);
    parts.push(`enrichmentOutputHash=${meta.enrichment.outputHash}`);
  }

  const inner = parts.join(" ");
  return `<!-- ${METADATA_MARKER} ${inner} -->`;
}

/**
 * Insert a metadata header into generated skill content.
 * If the content starts with YAML frontmatter (`---`), the metadata is inserted
 * immediately after the closing `---` so the frontmatter remains first.
 * Otherwise the metadata is prepended to the top of the file.
 */
export function applyMetadataHeader(content: string, header: string): string {
  if (!content.startsWith("---")) {
    return header + "\n" + content;
  }

  const lines = content.split("\n");
  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if ((lines[i] ?? "").trim() === "---") {
      closingIndex = i;
      break;
    }
  }

  if (closingIndex === -1) {
    // Malformed frontmatter — fall back to prepend
    return header + "\n" + content;
  }

  const before = lines.slice(0, closingIndex + 1).join("\n");
  const after = lines.slice(closingIndex + 1).join("\n");
  return before + "\n" + header + "\n" + after;
}

export function parseMetadataFromContent(content: string): SkillsMetadata | null {
  const lines = content.split("\n");

  // If content starts with YAML frontmatter, scan after the closing ---
  if (content.startsWith("---")) {
    let closingIndex = -1;
    for (let i = 1; i < lines.length; i++) {
      if ((lines[i] ?? "").trim() === "---") {
        closingIndex = i;
        break;
      }
    }
    if (closingIndex !== -1) {
      // Scan lines after the closing --- (where metadata header is placed by applyMetadataHeader)
      for (let i = closingIndex + 1; i < lines.length; i++) {
        const line = (lines[i] ?? "").trim();
        if (!line.includes(METADATA_MARKER)) continue;
        const inner = line
          .replace(/^<!--\s*/, "")
          .replace(/\s*-->$/, "")
          .replace(METADATA_MARKER, "")
          .trim();
        const pairs: Record<string, string> = {};
        for (const part of inner.split(" ")) {
          const eq = part.indexOf("=");
          if (eq !== -1) {
            pairs[part.slice(0, eq)] = part.slice(eq + 1);
          }
        }
        const { generatorVersion, sourceIndexSchema, sourceIndexHash, agent, projectName } = pairs;
        if (!generatorVersion || !sourceIndexHash || !agent) return null;

        // Parse enrichment fields if present
        const enrichmentMode = pairs["enrichmentMode"];
        let enrichment: EnrichmentMetadata | undefined;
        if (enrichmentMode) {
          if (enrichmentMode === "none") {
            enrichment = { mode: "none" };
          } else {
            enrichment = {
              mode: enrichmentMode as "ai",
              provider: pairs["enrichmentProvider"] ?? "",
              model: pairs["enrichmentModel"] ?? "",
              promptVersion: pairs["enrichmentPromptVersion"] ?? "",
              inputHash: pairs["enrichmentInputHash"] ?? "",
              outputHash: pairs["enrichmentOutputHash"] ?? "",
            };
          }
        }

        const result: SkillsMetadata = {
          generatorVersion,
          sourceIndexSchema: sourceIndexSchema ?? "",
          sourceIndexHash,
          agent: agent as AgentAdapterId,
          projectName: projectName ?? "",
        };
        if (pairs["generationConfigHash"]) {
          result.generationConfigHash = pairs["generationConfigHash"];
        }
        if (enrichment) result.enrichment = enrichment;
        return result;
      }
    }
    // If malformed frontmatter or no metadata found, fall back to scanning first 20 lines
  }

  // Fallback: scan first 20 lines (for non-frontmatter content or if above didn't find metadata)
  for (let i = 0; i < Math.min(20, lines.length); i++) {
    const line = (lines[i] ?? "").trim();
    if (!line.includes(METADATA_MARKER)) continue;
    const inner = line
      .replace(/^<!--\s*/, "")
      .replace(/\s*-->$/, "")
      .replace(METADATA_MARKER, "")
      .trim();
    const pairs: Record<string, string> = {};
    for (const part of inner.split(" ")) {
      const eq = part.indexOf("=");
      if (eq !== -1) {
        pairs[part.slice(0, eq)] = part.slice(eq + 1);
      }
    }
    const { generatorVersion, sourceIndexSchema, sourceIndexHash, agent, projectName } = pairs;
    if (!generatorVersion || !sourceIndexHash || !agent) return null;

    // Parse enrichment fields if present
    const enrichmentMode = pairs["enrichmentMode"];
    let enrichment: EnrichmentMetadata | undefined;
    if (enrichmentMode) {
      if (enrichmentMode === "none") {
        enrichment = { mode: "none" };
      } else {
        enrichment = {
          mode: enrichmentMode as "ai",
          provider: pairs["enrichmentProvider"] ?? "",
          model: pairs["enrichmentModel"] ?? "",
          promptVersion: pairs["enrichmentPromptVersion"] ?? "",
          inputHash: pairs["enrichmentInputHash"] ?? "",
          outputHash: pairs["enrichmentOutputHash"] ?? "",
        };
      }
    }

    const result: SkillsMetadata = {
      generatorVersion,
      sourceIndexSchema: sourceIndexSchema ?? "",
      sourceIndexHash,
      agent: agent as AgentAdapterId,
      projectName: projectName ?? "",
    };
    if (pairs["generationConfigHash"]) {
      result.generationConfigHash = pairs["generationConfigHash"];
    }
    if (enrichment) result.enrichment = enrichment;
    return result;
  }
  return null;
}
