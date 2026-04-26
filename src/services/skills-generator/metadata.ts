import { createHash } from "node:crypto";
import type { AgentAdapterId, SourceIndex } from "../../types/index.js";

export const METADATA_MARKER = "@mp-sentinel-generated";

export interface SkillsMetadata {
  generatorVersion: string;
  sourceIndexSchema: string;
  sourceIndexHash: string;
  agent: AgentAdapterId;
  projectName: string;
}

/** Sort a string-keyed record into stable [key, value] pairs for hashing. */
function sortRecord(obj: Record<string, string>): [string, string][] {
  return Object.entries(obj).sort((a, b) => a[0].localeCompare(b[0]));
}

/**
 * Deterministic hash covering all fields that affect generated skill content.
 * Excludes timestamps, duration stats, and cache metadata.
 */
export function computeIndexHash(index: SourceIndex): string {
  const stable = {
    schemaVersion: index.schemaVersion,
    project: {
      packageName: index.project.packageName,
      packageVersion: index.project.packageVersion,
      nodeEngine: index.project.nodeEngine,
      packageManager: index.project.packageManager,
      detectedFrameworks: [...index.project.detectedFrameworks].sort(),
      dependencies: sortRecord(index.project.dependencies),
      devDependencies: sortRecord(index.project.devDependencies),
    },
    files: index.files
      .map((f) => ({
        path: f.path,
        language: f.language,
        symbols: f.symbols
          .map((s) => ({ name: s.name, type: s.type }))
          .sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type)),
        importSources: f.imports.map((i) => i.source).sort(),
        importsFrom: (f.importsFrom ?? []).slice().sort(),
        importedBy: (f.importedBy ?? []).slice().sort(),
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex").slice(0, 16);
}

export function renderMetadataHeader(meta: SkillsMetadata): string {
  const inner = [
    `generatorVersion=${meta.generatorVersion}`,
    `sourceIndexSchema=${meta.sourceIndexSchema}`,
    `sourceIndexHash=${meta.sourceIndexHash}`,
    `agent=${meta.agent}`,
    `projectName=${meta.projectName}`,
  ].join(" ");
  return `<!-- ${METADATA_MARKER} ${inner} -->`;
}

export function parseMetadataFromContent(content: string): SkillsMetadata | null {
  const lines = content.split("\n");
  for (let i = 0; i < Math.min(3, lines.length); i++) {
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
    return {
      generatorVersion,
      sourceIndexSchema: sourceIndexSchema ?? "",
      sourceIndexHash,
      agent: agent as AgentAdapterId,
      projectName: projectName ?? "",
    };
  }
  return null;
}
