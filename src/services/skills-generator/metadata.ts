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
        return {
          generatorVersion,
          sourceIndexSchema: sourceIndexSchema ?? "",
          sourceIndexHash,
          agent: agent as AgentAdapterId,
          projectName: projectName ?? "",
        };
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
