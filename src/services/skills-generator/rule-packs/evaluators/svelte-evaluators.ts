/**
 * Svelte rule-pack evaluators — deterministic file checks for Svelte best practices.
 */

import type { FileEvaluator } from "../index.js";

/**
 * Detect imports outside `<script>` blocks in .svelte files.
 */
export const importsInsideScript: FileEvaluator = {
  ruleId: "imports-inside-script",
  evaluate: ({ filePath, content }) => {
    if (!filePath.endsWith(".svelte")) return [];

    // Find all <script> block ranges
    const scriptRanges: Array<[number, number]> = [];
    const scriptRe = /<script\b[^>]*>/g;
    let match: RegExpExecArray | null;
    while ((match = scriptRe.exec(content)) !== null) {
      const openStart = match.index;
      const closeTag = content.indexOf("</script>", openStart);
      if (closeTag !== -1) {
        scriptRanges.push([openStart, closeTag + "</script>".length]);
      }
    }

    // Check each line for imports outside script blocks
    const lines = content.split("\n");
    const results: Array<{
      ruleId: string;
      passed: boolean;
      message: string;
      line: number;
      column: number;
      severity: "CRITICAL" | "WARNING" | "INFO";
      suggestion: string;
    }> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // Look for import statements
      if (!/^\s*import\s/.test(line)) continue;

      const lineStart = lines.slice(0, i).join("\n").length + (i > 0 ? 1 : 0);
      const inScript = scriptRanges.some(([start, end]) => lineStart >= start && lineStart < end);
      // Also check if we're inside an HTML template or style block
      const inTemplate = isInBlock(content, lineStart, "</style>", "</template>");

      if (!inScript && !inTemplate) {
        // Import outside script — but might be in template (allowed for SvelteKit imports)
        results.push({
          ruleId: "imports-inside-script",
          passed: false,
          message:
            'Import statement found outside `<script>` block. In Svelte files, all import statements must be inside the `<script lang="ts">` block.',
          line: i + 1,
          column: line.search(/\S/) + 1,
          severity: "WARNING",
          suggestion:
            'Move the import inside the `<script lang="ts">` block at the top of the file.',
        });
      }
    }

    return results;
  },
};

/**
 * Check if a position in content falls within a non-script block (template/style).
 */
function isInBlock(content: string, pos: number, ...blockEndTags: string[]): boolean {
  // Find all script blocks
  const scriptEndTags = ["</script>"];
  const allEndTags = [...scriptEndTags, ...blockEndTags];

  // Track which block we're in at the given position
  let depth = 0;
  let inScript = false;
  const lines = content.split("\n");
  let currentPos = 0;

  for (const line of lines) {
    if (currentPos > pos) break;

    const nextLineStart = currentPos + line.length + 1;

    if (!inScript) {
      if (/<script\b/.test(line)) inScript = true;
    } else {
      if (line.includes("</script>")) inScript = false;
    }

    if (currentPos <= pos && pos < nextLineStart) {
      return inScript;
    }

    currentPos = nextLineStart;
  }

  return false;
}
