/**
 * Code Samples — deterministic, secret-scrubbed file sampling for AI enrichment.
 *
 * Selects up to N files from the source index, reads them from disk, runs
 * them through SecurityService.sanitize() before returning. Every returned
 * sample carries a `__scrubbed: true` brand so downstream consumers can
 * assert that no un-scrubbed content enters the AI prompt.
 *
 * Only used when AI enrichment is enabled (createSkills.ai.enabled === true).
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SourceIndex, LanguageProfile, CodeStyleProfile } from "../../types/index.js";
import { SecurityService } from "../security/index.js";

// ── Brand type ──────────────────────────────────────────────────────────────

/**
 * A code sample that has passed through the SecurityService scrubber.
 * The `__scrubbed` brand allows runtime assertions that no raw content
 * leaks into the AI prompt.
 */
export interface ScrubbedCodeSample {
  path: string;
  content: string;
  redacted: boolean;
  __scrubbed: true;
}

// ── Options ─────────────────────────────────────────────────────────────────

export interface LoadCodeSamplesOptions {
  /** Max number of samples to return (default 5) */
  maxSamples?: number;
  /** Max lines per sample (default 40) */
  maxLinesPerSample?: number;
  /** Project root for reading files (default used from caller) */
  projectRoot: string;
}

// ── Selection strategy ─────────────────────────────────────────────────────

function selectSampleFiles(
  index: SourceIndex,
  langProfile: LanguageProfile,
  maxSamples: number,
): string[] {
  if (index.files.length === 0) return [];

  const selected = new Set<string>();

  // 1. Largest non-test file in the dominant language
  const dominantLangFiles = index.files.filter(
    (f) =>
      f.language === langProfile.dominant &&
      !f.path.includes(".test.") &&
      !f.path.includes(".spec.") &&
      !f.path.includes("__tests__"),
  );
  dominantLangFiles.sort(
    (a, b) =>
      (b.imports?.length ?? 0) +
      (b.exports?.length ?? 0) -
      ((a.imports?.length ?? 0) + (a.exports?.length ?? 0)),
  );
  if (dominantLangFiles[0]) {
    selected.add(dominantLangFiles[0].path);
  }

  // 2. One hub file (most imported)
  const hubFiles = [...index.files]
    .filter((f) => (f.importedBy?.length ?? 0) > 1 && !selected.has(f.path))
    .sort((a, b) => (b.importedBy?.length ?? 0) - (a.importedBy?.length ?? 0));
  if (hubFiles[0]) {
    selected.add(hubFiles[0].path);
  }

  // 3. One test file
  const testFile = index.files.find(
    (f) =>
      !selected.has(f.path) &&
      (f.path.includes(".test.") || f.path.includes(".spec.") || f.path.includes("__tests__")),
  );
  if (testFile) {
    selected.add(testFile.path);
  }

  // 4. One component file (.svelte, .vue, .tsx, .jsx) if available
  const componentFile = index.files.find(
    (f) =>
      !selected.has(f.path) &&
      (f.path.endsWith(".svelte") ||
        f.path.endsWith(".vue") ||
        f.path.endsWith(".tsx") ||
        f.path.endsWith(".jsx")),
  );
  if (componentFile) {
    selected.add(componentFile.path);
  }

  // 5. One entrypoint or import-heavy file
  const importHeavy = [...index.files]
    .filter((f) => !selected.has(f.path))
    .sort((a, b) => (b.imports?.length ?? 0) - (a.imports?.length ?? 0));
  if (importHeavy[0]) {
    selected.add(importHeavy[0].path);
  }

  return [...selected].slice(0, maxSamples);
}

// ── Main function ──────────────────────────────────────────────────────────

/**
 * Load code samples from disk, run them through the SecurityService scrubber,
 * and return scrubbed samples with the `__scrubbed: true` brand.
 *
 * @param projectRoot - Project root directory
 * @param index - Source index for file selection
 * @param langProfile - Language profile for selection strategy
 * @param opts - Optional overrides
 * @returns Array of scrubbed code samples
 */
export async function loadAndScrubCodeSamples(
  projectRoot: string,
  index: SourceIndex,
  langProfile: LanguageProfile,
  opts: LoadCodeSamplesOptions,
): Promise<ScrubbedCodeSample[]> {
  const maxSamples = opts.maxSamples ?? 5;
  const maxLinesPerSample = opts.maxLinesPerSample ?? 40;

  const filePaths = selectSampleFiles(index, langProfile, maxSamples);
  if (filePaths.length === 0) return [];

  // Read files from disk
  const rawSamples: Array<{ path: string; content: string }> = [];
  for (const filePath of filePaths) {
    const absPath = join(projectRoot, filePath);
    try {
      const content = await readFile(absPath, "utf-8");
      // Cap at maxLinesPerSample lines
      const lines = content.split("\n");
      const capped = lines.slice(0, maxLinesPerSample).join("\n");
      rawSamples.push({ path: filePath, content: capped });
    } catch {
      // File may not exist (stale index) — skip
    }
  }

  // Run through scrubber
  const scrubber = new SecurityService();
  const { sanitizedFiles, totalRedacted } = scrubber.sanitizeFiles(rawSamples);

  // Brand as scrubbed
  const result: ScrubbedCodeSample[] = sanitizedFiles.map((f) => ({
    path: f.path,
    content: f.content,
    redacted: totalRedacted > 0,
    __scrubbed: true as const,
  }));

  return result;
}
