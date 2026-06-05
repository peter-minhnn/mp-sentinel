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
