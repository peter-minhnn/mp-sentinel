/**
 * Config-aware TypeScript flag inspection for generated skill content.
 *
 * Generated rules must reflect the project's REAL tsconfig:
 * - `.js` import-extension rules apply only under NodeNext/Node16 resolution,
 *   never under `moduleResolution: "bundler"` (Vite, Next.js, etc.).
 * - Strict-flag reminders (`verbatimModuleSyntax`, `noUncheckedIndexedAccess`,
 *   ...) are emitted only when the flag is actually enabled.
 *
 * When no tsconfig is available the helpers fall back to the historical
 * behavior (NodeNext-style guidance) so existing CLI/library projects keep
 * their rules.
 */

export interface TsConfigLike {
  compilerOptions: Record<string, unknown>;
  extends?: string;
}

/** Strict flags that generated content may individually call out. */
export const STRICT_FLAG_NAMES = [
  "strict",
  "exactOptionalPropertyTypes",
  "noUncheckedIndexedAccess",
  "noImplicitReturns",
  "noFallthroughCasesInSwitch",
  "verbatimModuleSyntax",
] as const;

export type StrictFlagName = (typeof STRICT_FLAG_NAMES)[number];

function optionString(tsConfig: TsConfigLike | undefined, key: string): string | undefined {
  const value = tsConfig?.compilerOptions?.[key];
  return typeof value === "string" ? value.toLowerCase() : undefined;
}

/**
 * True when internal imports must carry the `.js` extension (NodeNext/Node16
 * ESM resolution). Bundler resolution (Vite/Next/webpack) returns false.
 * Without a tsconfig, defaults to true (historical behavior for Node tools).
 */
export function requiresJsImportExtensions(tsConfig: TsConfigLike | undefined): boolean {
  if (!tsConfig) return true;
  const moduleResolution = optionString(tsConfig, "moduleResolution");
  if (moduleResolution === "bundler") return false;
  if (moduleResolution === "nodenext" || moduleResolution === "node16") return true;
  const moduleKind = optionString(tsConfig, "module");
  if (moduleKind === "nodenext" || moduleKind === "node16") return true;
  // Classic/node10/undefined resolution: extensions are not required.
  if (moduleResolution !== undefined) return false;
  return moduleKind === undefined;
}

/** True when the given strict flag is explicitly enabled in compilerOptions. */
export function isFlagEnabled(tsConfig: TsConfigLike | undefined, flag: StrictFlagName): boolean {
  return tsConfig?.compilerOptions?.[flag] === true;
}

/** List of strict flags explicitly enabled in the project's tsconfig. */
export function enabledStrictFlags(tsConfig: TsConfigLike | undefined): StrictFlagName[] {
  return STRICT_FLAG_NAMES.filter((flag) => isFlagEnabled(tsConfig, flag));
}

/**
 * `import type` guidance applies when `verbatimModuleSyntax` is enabled,
 * or when no tsconfig is available (historical default).
 */
export function recommendsImportType(tsConfig: TsConfigLike | undefined): boolean {
  if (!tsConfig) return true;
  return isFlagEnabled(tsConfig, "verbatimModuleSyntax");
}
