/**
 * Shared skills-generator constants.
 *
 * Lives in its own module so low-level helpers (instruction-files.ts) and
 * higher-level modules (metadata.ts, legacy-detection.ts) can share the
 * generated-file marker without import cycles.
 */

/**
 * Marker embedded in every generated file's metadata header.
 * Contractual parse key — do not change (see AGENTS.md §4).
 */
export const METADATA_MARKER = "@mp-sentinel-generated";

/**
 * Stable HTML-comment boundaries wrapping the project-authored
 * "Project Rules (authoritative)" section. Quality checks that must scan
 * only GENERATED guidance (e.g. stack-consistency) strip everything between
 * these markers. They are invisible in rendered Markdown and survive nested
 * Markdown headings inside project rules / ruleFiles content (where an H2
 * boundary heuristic would stop early).
 */
export const PROJECT_RULES_START_MARKER = "<!-- mp-sentinel-project-rules:start -->";
export const PROJECT_RULES_END_MARKER = "<!-- mp-sentinel-project-rules:end -->";
