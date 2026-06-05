/**
 * Deterministic, conservative dependency-version gating for rule packs.
 *
 * Rules and evaluators may declare `requires` constraints (e.g. "svelte
 * major >= 5"). A constraint is satisfied ONLY when the manifest range
 * makes the dependency major safely identifiable. Unknown, broad, or
 * non-registry ranges (`*`, `latest`, `>=4`, `file:`, `link:`, git URLs,
 * bare `workspace:*`) resolve to "unknown" and the gated rule is dropped —
 * stable generic rules only, never latest-version advice on uncertain input.
 *
 * No AI calls, no network — pure string parsing of package.json ranges.
 */

// ── Range parsing ────────────────────────────────────────────────────────────

/** Match a leading version: 5 / 5.1 / 5.1.2 / 5.x / 5.* (with optional v prefix). */
const VERSION_HEAD = /^v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?(?:[-+][\w.-]+)?$/;

/** Tokens that can never identify a major. */
const UNRESOLVABLE_PREFIXES = ["file:", "link:", "git:", "git+", "http:", "https:", "github:"];
const UNRESOLVABLE_TAGS = new Set([
  "",
  "*",
  "x",
  "x.x",
  "x.x.x",
  "latest",
  "next",
  "beta",
  "alpha",
  "canary",
  "rc",
]);

const parseBareMajor = (token: string): number | null => {
  const match = token.match(VERSION_HEAD);
  if (!match || !match[1]) return null;
  return Number.parseInt(match[1], 10);
};

/** Resolve `>=A <B`-style compound ranges that pin a single major. */
const parseCompoundMajor = (tokens: string[]): number | null => {
  let lowerMajor: number | null = null;
  let upperMajor: number | null = null;
  let upperExclusive = false;

  for (const token of tokens) {
    if (token.startsWith(">=")) {
      lowerMajor = parseBareMajor(token.slice(2).trim());
      if (lowerMajor === null) return null;
    } else if (token.startsWith("<=")) {
      upperMajor = parseBareMajor(token.slice(2).trim());
      upperExclusive = false;
      if (upperMajor === null) return null;
    } else if (token.startsWith(">")) {
      lowerMajor = parseBareMajor(token.slice(1).trim());
      if (lowerMajor === null) return null;
    } else if (token.startsWith("<")) {
      upperMajor = parseBareMajor(token.slice(1).trim());
      upperExclusive = true;
      if (upperMajor === null) return null;
    } else {
      return null; // Mixed plain pins inside a compound range — too ambiguous
    }
  }

  if (lowerMajor === null || upperMajor === null) return null; // One-sided — broad
  const effectiveUpper = upperExclusive ? upperMajor - 1 : upperMajor;
  return lowerMajor === effectiveUpper ? lowerMajor : null;
};

/**
 * Conservatively resolve a package.json range to a single identifiable
 * major version. Returns null when the major cannot be safely determined.
 */
export function resolveSafeMajor(range: string | undefined): number | null {
  if (range === undefined) return null;
  let value = range.trim();
  const lower = value.toLowerCase();

  if (UNRESOLVABLE_TAGS.has(lower)) return null;
  if (UNRESOLVABLE_PREFIXES.some((p) => lower.startsWith(p))) return null;

  // npm alias: "npm:pkg@^5.0.0" — parse the embedded range after the last @
  if (lower.startsWith("npm:")) {
    const at = value.lastIndexOf("@");
    if (at <= 4) return null; // "npm:pkg" with no version
    return resolveSafeMajor(value.slice(at + 1));
  }

  // workspace protocol: "workspace:^5.0.0" resolves; bare "workspace:*" / "workspace:^" does not
  if (lower.startsWith("workspace:")) {
    return resolveSafeMajor(value.slice("workspace:".length));
  }

  // Union ranges: only safe when every branch resolves to the same major
  if (value.includes("||")) {
    const majors = value.split("||").map((part) => resolveSafeMajor(part.trim()));
    if (majors.some((m) => m === null)) return null;
    const first = majors[0]!;
    return majors.every((m) => m === first) ? first : null;
  }

  // Caret / tilde / equals keep the major
  if (value.startsWith("^") || value.startsWith("~") || value.startsWith("=")) {
    value = value.replace(/^[\^~=]+/, "").trim();
    return parseBareMajor(value);
  }

  // Inequalities: one-sided is broad; ">=A <B" pinning one major resolves
  if (/^[<>]/.test(value)) {
    const tokens = value.split(/\s+/).filter(Boolean);
    return parseCompoundMajor(tokens);
  }

  // Hyphen ranges "4.0.0 - 4.9.9": safe only when both ends share a major
  const hyphen = value.split(/\s+-\s+/);
  if (hyphen.length === 2) {
    const a = parseBareMajor(hyphen[0]!.trim());
    const b = parseBareMajor(hyphen[1]!.trim());
    return a !== null && a === b ? a : null;
  }

  // Bare versions / X-ranges: "5", "5.0.1", "5.x" — major identifiable.
  // "x.2" or other leading wildcards already filtered above.
  return parseBareMajor(value);
}

// ── Requirement model ────────────────────────────────────────────────────────

/** A conservative dependency-major requirement. */
export interface VersionRequirement {
  /** Dependency name as it appears in package.json (deps or devDeps). */
  dep: string;
  /** Minimum safely-identified major (inclusive). */
  minMajor?: number;
  /** Maximum safely-identified major (inclusive). */
  maxMajor?: number;
}

/**
 * Check a single requirement against the merged dependency map.
 * Unknown majors never satisfy a requirement (conservative).
 */
export function requirementSatisfied(
  req: VersionRequirement,
  deps: Record<string, string>,
): boolean {
  const major = resolveSafeMajor(deps[req.dep]);
  if (major === null) return false;
  if (req.minMajor !== undefined && major < req.minMajor) return false;
  if (req.maxMajor !== undefined && major > req.maxMajor) return false;
  return true;
}

/** All requirements must hold. No requirements = always satisfied. */
export function requirementsSatisfied(
  requires: readonly VersionRequirement[] | undefined,
  deps: Record<string, string>,
): boolean {
  if (!requires || requires.length === 0) return true;
  return requires.every((req) => requirementSatisfied(req, deps));
}
