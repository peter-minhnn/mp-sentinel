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
 * Maximum number of packages carried in the generated dependency map.
 *
 * Single source of truth: the knowledge base caps `dependencies` at this
 * value and the Dependencies reference renders every entry it receives, so
 * the "N dependencies" count in SKILL.md always matches the rendered table.
 */
export const MAX_TRACKED_DEPENDENCIES = 15;

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

/**
 * Stable boundaries wrapping the project-authored skill overlay. Same role as
 * the project-rules markers: quality checks that must scan only GENERATED
 * guidance strip everything between them.
 */
export const SKILL_OVERLAY_START_MARKER = "<!-- mp-sentinel-skill-overlay:start -->";
export const SKILL_OVERLAY_END_MARKER = "<!-- mp-sentinel-skill-overlay:end -->";

/**
 * Conventional overlay path, used when `createSkills.overlayFile` is unset.
 * Present-but-unconfigured is treated as opt-in: dropping the file in is
 * enough, no config edit required.
 */
export const DEFAULT_SKILL_OVERLAY_PATH = ".mp-sentinel/skill-overlay.md";

/** Hard cap on overlay content copied into every generated skill file. */
export const MAX_SKILL_OVERLAY_CHARS = 12000;

/**
 * Minimum indexed-file count before usage-based signals are trusted.
 *
 * "Imported by fewer than N files" only means "incidental" in a codebase big
 * enough for that to be a choice. In a ten-file project a library touched
 * twice IS the stack, and in fixtures or freshly scaffolded repos the import
 * graph may be empty altogether — gating there would strip correct guidance.
 */
export const MIN_FILES_FOR_USAGE_SIGNALS = 40;
