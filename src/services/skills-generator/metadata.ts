import { createHash } from "node:crypto";
import type { AgentAdapterId, EnrichmentMetadata, SourceIndex } from "../../types/index.js";

export const METADATA_MARKER = "@mp-sentinel-generated";

export interface SkillsMetadata {
  generatorVersion: string;
  sourceIndexSchema: string;
  sourceIndexHash: string;
  agent: AgentAdapterId;
  projectName: string;
  enrichment?: EnrichmentMetadata;
}

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

export function computeIndexHash(index: SourceIndex): string {
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
    if (enrichment) result.enrichment = enrichment;
    return result;
  }
  return null;
}
