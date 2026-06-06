/**
 * Profile detection for generated skill quality.
 * Maps source-index / package manifest signals to actionable skill profiles.
 */

import type { SourceIndex, SkillProfile } from "../../types/index.js";

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
 * Detect the most appropriate skill profile from a source index.
 * No CLI flag required — fully derived from manifest + dependency graph.
 */
export function detectProfile(index: SourceIndex | null): SkillProfile {
  if (!index) return "library";

  const { dependencies, devDependencies, detectedFrameworks, scripts, bin } = index.project;
  const allDeps = { ...dependencies, ...devDependencies };

  // react-next: only when Next.js is explicitly present
  if (detectedFrameworks.includes("next.js") || allDeps["next"]) {
    return "react-next";
  }
  // react-spa: React without Next.js (Vite, CRA, React Router, etc.)
  if (
    detectedFrameworks.includes("react") ||
    allDeps["react"] !== undefined ||
    allDeps["react-dom"] !== undefined
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
  for (const dep of Object.keys(allDeps)) {
    if (SERVICE_DEPS.has(dep)) return "node-service";
  }

  // cli-tooling
  if (bin !== undefined) return "cli-tooling";
  if (scripts) {
    const values = Object.values(scripts).join(" ");
    if (values.includes("cli") || values.includes("bin")) return "cli-tooling";
  }
  for (const dep of Object.keys(allDeps)) {
    if (CLI_DEPS.has(dep)) return "cli-tooling";
  }

  return "library";
}

export type { SkillProfile };
