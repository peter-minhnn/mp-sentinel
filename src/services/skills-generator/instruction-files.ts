/**
 * Shared instruction-file discovery for generated skills.
 *
 * Used by both `knowledge-base.ts` (the "Read local agent instructions"
 * workflow step) and `metadata.ts` (fidelity signals in the --check hash)
 * so the two can never drift.
 *
 * Current/official paths are listed when they exist. Legacy generated
 * locations (`.windsurf/rules`, `.roo/rules`, `.clinerules`) are listed
 * ONLY when they contain user-authored content: files carrying the
 * `@mp-sentinel-generated` marker are superseded by the official skill
 * folders and must not be recommended reading (they remain on disk as
 * advisory-only migration leftovers — never deleted).
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { METADATA_MARKER } from "./constants.js";

/** Official/current instruction locations, in recommendation order. */
export const CURRENT_INSTRUCTION_PATHS: readonly string[] = [
  "AGENTS.md",
  "CLAUDE.md",
  ".claude/skills",
  ".agents/skills",
  ".agents/rules",
  ".cursor/rules",
  ".windsurf/skills",
  ".roo/skills",
  ".cline/skills",
  ".codex/rules",
  ".antigravity/rules",
];

/**
 * Locations that old mp-sentinel versions generated rules into. Still
 * valid as USER instruction locations, but generated leftovers there are
 * superseded by the skill folders above.
 */
export const LEGACY_GENERATED_INSTRUCTION_PATHS: readonly string[] = [
  ".windsurf/rules",
  ".roo/rules",
  ".clinerules",
];

const isMarkdownFile = (name: string): boolean => /\.(md|mdc)$/i.test(name);

const fileIsUserAuthored = (absPath: string): boolean => {
  try {
    return !readFileSync(absPath, "utf-8").includes(METADATA_MARKER);
  } catch {
    // Unreadable — keep discoverable rather than silently hiding user content
    return true;
  }
};

/**
 * True when the legacy path holds any user-authored instruction content.
 * A directory counts when at least one markdown file inside lacks the
 * generated-metadata marker; a plain file counts when it lacks the marker.
 * Empty or fully-generated locations return false.
 */
function hasUserAuthoredContent(absPath: string): boolean {
  try {
    const stats = statSync(absPath);
    if (stats.isFile()) {
      return fileIsUserAuthored(absPath);
    }
    if (!stats.isDirectory()) return false;
    const entries = readdirSync(absPath, { withFileTypes: true });
    return entries.some(
      (entry) =>
        entry.isFile() &&
        isMarkdownFile(entry.name) &&
        fileIsUserAuthored(join(absPath, entry.name)),
    );
  } catch {
    return false;
  }
}

/**
 * Detect instruction files/directories to recommend in generated skills:
 * all existing official paths, plus legacy locations that still contain
 * user-authored (non-generated) content.
 */
export function detectInstructionFiles(projectRoot: string): string[] {
  const found: string[] = [];
  for (const relPath of CURRENT_INSTRUCTION_PATHS) {
    if (existsSync(join(projectRoot, relPath))) {
      found.push(relPath);
    }
  }
  for (const relPath of LEGACY_GENERATED_INSTRUCTION_PATHS) {
    const absPath = join(projectRoot, relPath);
    if (existsSync(absPath) && hasUserAuthoredContent(absPath)) {
      found.push(relPath);
    }
  }
  return found;
}
