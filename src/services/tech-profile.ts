/**
 * Tech Profile Detection — unified tech stack inference for review cue generation.
 * Priority chain: config.techStack → package.json → generic.
 * Works without a source index.
 */

import type { ProjectConfig, SkillProfile, TechProfile } from "../types/index.js";
import { parseTechStack } from "./skills-fetcher.js";
import { readPackageManifest, detectFrameworks } from "./source-index/manifest.js";
import { log } from "../utils/logger.js";

// ── Technology-to-cue mappings ──────────────────────────────────────────────

const normalizeKey = (s: string): string => s.toLowerCase().replace(/[.\-/@]/g, "");

const TECHNOLOGY_CUES: Record<string, string[]> = {
  typescript: [
    "Verify strict null checks — avoid `as any` and non-null assertions that bypass type safety",
    "Audit catch-clause types: prefer `unknown` over `any`",
    "Check that exported types are accurate and complete",
  ],
  javascript: [
    "Validate defensive checks for null/undefined before property access",
    "Check for missing `use strict` or inconsistent module patterns",
  ],
  react: [
    "Audit hooks dependency arrays (useEffect, useMemo, useCallback) for completeness",
    "Verify hooks are called unconditionally (no conditional or loop calls)",
    "Check that `.map()` keys are stable identifiers, not array indices",
  ],
  nextjs: [
    "Respect server/client component boundaries — avoid client logic in server components",
    "Use `next/image` for external images with configured domains",
    "Colocate data fetching as close as possible to where it is used",
  ],
  express: [
    "Validate all async route handlers have error catching or wrap with asyncHandler",
    "Check that environment variables are validated at startup, not per-request",
    "Ensure response is sent exactly once per request path",
  ],
  fastify: [
    "Verify schema validation is used for request/response bodies",
    "Check that plugins are registered with `await` or `.register()` callbacks",
  ],
  nestjs: [
    "Validate that DTO classes use class-validator decorators",
    "Check that modules follow single-responsibility — one feature per module",
  ],
  commander: [
    "Exit codes must be a documented contract — never silently change 0/1/2 semantics",
    "All user-facing output to stdout, diagnostics to stderr",
  ],
  jest: [
    "Prefer specific matchers (toEqual, toStrictEqual) over toBeTruthy/toBeFalsy",
    "Ensure mock cleanup runs in afterEach/afterAll",
  ],
  vitest: [
    "Prefer specific assertions — avoid `expect(x).toBeTruthy()`",
    "Check that vi.mock() calls are hoisted to top of file",
    "Verify test isolation: no shared mutable state between tests",
  ],
  playwright: ["Verify selectors use data-testid attributes, not CSS classes or text content"],
  vite: ["Check for large dependencies in client bundles — prefer dynamic imports"],
  esbuild: ["Verify that platform-specific code is behind conditional imports or build flags"],
  webpack: ["Audit bundle size impact of new dependencies"],
  nodejs: ["Check ESM/CJS compatibility — avoid mixing `require` and `import` in the same module"],
  prisma: [
    "Validate migration safety — check for destructive column changes",
    "Verify query efficiency — watch for N+1 patterns in relations",
  ],
  tailwindcss: ["Check for unused utility classes and responsive design coverage"],
  postgresql: ["Check query performance and connection pooling configuration"],
  mongodb: ["Verify index usage and query patterns for performance"],
  redis: ["Check cache invalidation strategy and TTL configuration"],
  graphql: [
    "Validate resolver performance — watch for N+1 queries",
    "Check that input types have proper validation",
  ],
  docker: ["Verify multi-stage builds and layer caching optimization"],
};

// ── Profile-level fallback cues ─────────────────────────────────────────────

const PROFILE_CUES: Record<SkillProfile, string[]> = {
  "cli-tooling": [
    "Exit codes are a contract — never change 0/1/2 semantics without a breaking-change note",
    "Keep CLI parsing separate — argument parsing belongs in src/cli/",
    "No business logic in entry files — they should only route",
  ],
  "node-service": [
    "Handler purity — ensure request handlers are stateless",
    "Centralized error handling with proper status codes",
    "Validate required env vars on startup, fail fast",
    "Implement /health and /ready endpoints for orchestration",
  ],
  "react-next": [
    "Server/Client boundary — respect 'use client' directive",
    "Colocate data fetching close to where it is used",
    "Avoid large dependencies in client bundles, use dynamic imports",
  ],
  "react-spa": [
    "Route-level code splitting — lazy-load route components to keep the initial bundle small",
    "Keep server state in a data library (React Query/SWR), not in component state",
    "Audit hooks dependency arrays for completeness",
    "Avoid large dependencies in the client bundle, use dynamic imports",
  ],
  library: [
    "Public API surface — consider semver impact of every exported symbol",
    "Ensure .d.ts files are accurate and complete",
    "Declare peerDependencies, not dependencies, for host packages",
    "Avoid side effects in module initialization",
  ],
};

// ── Profile inference ──────────────────────────────────────────────────────

const CLI_DEPS = new Set([
  "commander",
  "yargs",
  "minimist",
  "arg",
  "oclif",
  "ink",
  "pastel",
  "clipboardy",
]);

const SERVICE_DEPS = new Set([
  "express",
  "fastify",
  "nestjs",
  "@nestjs/core",
  "@nestjs/common",
  "koa",
  "hapi",
  "restify",
  "@fastify",
]);

/**
 * Infer SkillProfile from a set of lowercase technology keywords.
 * Precedence matches detectProfile(): react-next > node-service > cli-tooling > library.
 */
function inferProfileFromKeywords(keywords: Set<string>): SkillProfile {
  if (keywords.has("next") || keywords.has("nextjs") || keywords.has("next.js")) {
    return "react-next";
  }
  if (keywords.has("react")) {
    return "react-spa";
  }
  if (
    keywords.has("express") ||
    keywords.has("fastify") ||
    keywords.has("nestjs") ||
    keywords.has("koa")
  ) {
    return "node-service";
  }
  if (
    keywords.has("commander") ||
    keywords.has("yargs") ||
    keywords.has("oclif") ||
    keywords.has("cli") ||
    keywords.has("bin")
  ) {
    return "cli-tooling";
  }
  return "library";
}

/**
 * Infer SkillProfile from package.json manifest fields.
 * Precedence matches detectProfile(): react-next > node-service > cli-tooling > library.
 */
function inferProfileFromManifest(
  deps: Record<string, string>,
  detectedFrameworks: string[],
  bin: string | Record<string, string> | undefined,
  scripts: Record<string, string>,
): SkillProfile {
  const allDepKeys = new Set(Object.keys(deps).map((d) => d.toLowerCase()));

  // react-next: only when Next.js is explicitly present
  if (detectedFrameworks.includes("next.js") || allDepKeys.has("next")) {
    return "react-next";
  }
  // react-spa: React without Next.js
  if (
    detectedFrameworks.includes("react") ||
    allDepKeys.has("react") ||
    allDepKeys.has("react-dom")
  ) {
    return "react-spa";
  }

  // node-service
  if (
    detectedFrameworks.includes("express") ||
    detectedFrameworks.includes("fastify") ||
    detectedFrameworks.includes("nestjs")
  ) {
    return "node-service";
  }
  for (const dep of allDepKeys) {
    if (SERVICE_DEPS.has(dep)) return "node-service";
  }

  // cli-tooling
  if (bin !== undefined) return "cli-tooling";
  const scriptValues = Object.values(scripts).join(" ");
  if (scriptValues.includes("cli") || scriptValues.includes("bin")) return "cli-tooling";
  for (const dep of allDepKeys) {
    if (CLI_DEPS.has(dep)) return "cli-tooling";
  }

  return "library";
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Detect tech profile with priority chain:
 *   1. config.techStack (user-specified, highest signal)
 *   2. package.json on disk (dependencies, devDependencies, frameworks, bin, scripts)
 *   3. Generic fallback
 */
export async function detectTechProfile(
  config: ProjectConfig,
  cwd: string = process.cwd(),
): Promise<TechProfile> {
  // Priority 1: config.techStack
  if (config.techStack && config.techStack.trim().length > 0) {
    const technologies = parseTechStack(config.techStack);
    const keywords = new Set(technologies.map((t) => t.toLowerCase()));
    const profile = inferProfileFromKeywords(keywords);
    return {
      profile,
      technologies: [...new Set(technologies)],
      source: "config",
    };
  }

  // Priority 2: package.json inference
  try {
    const manifest = await readPackageManifest(cwd);
    const allDeps = { ...manifest.dependencies, ...manifest.devDependencies };

    if (
      Object.keys(allDeps).length > 0 ||
      manifest.bin !== undefined ||
      Object.keys(manifest.scripts).length > 0
    ) {
      const frameworks = detectFrameworks(cwd, manifest.dependencies, manifest.devDependencies);
      const profile = inferProfileFromManifest(allDeps, frameworks, manifest.bin, manifest.scripts);

      // Collect technology keywords: frameworks + dependency names
      const technologies = new Set<string>();
      for (const fw of frameworks) {
        technologies.add(fw.toLowerCase());
      }
      for (const dep of Object.keys(allDeps)) {
        technologies.add(dep.toLowerCase());
      }

      return {
        profile,
        technologies: [...technologies],
        source: "package-json",
      };
    }
  } catch (err) {
    log.debug(
      `Tech profile: package.json fallback failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Priority 3: Generic
  return {
    profile: "library",
    technologies: [],
    source: "generic",
  };
}

/**
 * Generate review cues from a TechProfile.
 * Prioritizes technology-specific cues, falls back to profile-level pitfalls.
 * Deduplicates and caps at 5 cues.
 */
export function getReviewCues(profile: TechProfile): string[] {
  const cues: string[] = [];
  const techIndex = new Map<string, string[]>();
  for (const [key, cueList] of Object.entries(TECHNOLOGY_CUES)) {
    techIndex.set(normalizeKey(key), cueList);
  }

  for (const tech of profile.technologies) {
    const normalized = normalizeKey(tech);
    const techCues = techIndex.get(normalized);
    if (techCues) {
      cues.push(...techCues);
    }
  }

  const profileCues = PROFILE_CUES[profile.profile];

  if (cues.length === 0) {
    // No tech-specific cues — fall back to profile-level pitfalls
    cues.push(...profileCues);
  } else if (cues.length < 5) {
    // Supplement tech cues with profile cues up to the cap
    const remaining = 5 - cues.length;
    cues.push(...profileCues.slice(0, remaining));
  }

  // Deduplicate by normalized key (first 60 chars)
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const cue of cues) {
    const key = normalizeKey(cue.slice(0, 60));
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(cue);
    }
  }

  return deduped.slice(0, 5);
}
