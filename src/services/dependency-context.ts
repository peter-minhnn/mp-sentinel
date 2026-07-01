/**
 * Dependency/Version context for review prompts.
 *
 * Builds a compact summary of project dependencies and the versions ACTUALLY
 * installed (read from `node_modules/<pkg>/package.json`, so it works with any
 * package manager including Bun's binary lockfile). Giving the model the
 * resolved version — not the package.json range — is what lets the version-claim
 * guardrails ("confirm against the installed version") actually bite, and puts
 * the framework a finding reasons about (react, antd, @tanstack/*, …) in front
 * of the model instead of buried past an alphabetical cutoff.
 *
 * No live network calls. Never throws — returns an empty summary on any error.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export interface DependencyContext {
  /** Compact string suitable for inclusion in system prompts */
  summary: string;
  /** Number of production dependencies included */
  depCount: number;
  /** Whether a lockfile was detected */
  lockfileDetected: boolean;
}

/**
 * Frameworks/libraries whose exact version most often drives a review finding
 * (API removals, deprecations, breaking changes). These are surfaced first so
 * they are never dropped by the entry cap. Scope prefixes (ending in `/`) match
 * any package under that scope.
 */
const PRIORITY_DEPENDENCIES: readonly string[] = [
  "react",
  "react-dom",
  "next",
  "vue",
  "svelte",
  "@angular/core",
  "antd",
  "@mui/material",
  "@chakra-ui/react",
  "tailwindcss",
  "@tanstack/", // react-query, react-router, table, …
  "react-router-dom",
  "axios",
  "zustand",
  "@reduxjs/toolkit",
  "redux",
  "vite",
  "typescript",
  "dayjs",
  "date-fns",
  "zod",
];

const isPriority = (name: string): boolean =>
  PRIORITY_DEPENDENCIES.some((p) => (p.endsWith("/") ? name.startsWith(p) : name === p));

/** Read the installed (resolved) version from node_modules, or null if absent. */
const resolveInstalledVersion = (cwd: string, name: string): string | null => {
  try {
    const pkgPath = resolve(cwd, "node_modules", name, "package.json");
    if (!existsSync(pkgPath)) return null;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
};

interface DepRef {
  name: string;
  range: string;
  dev: boolean;
}

/** Order deps priority-first (preserving declaration order within each group). */
const selectDependencies = (
  dependencies: Record<string, string>,
  devDependencies: Record<string, string>,
  max: number,
): DepRef[] => {
  const prod = Object.keys(dependencies).map(
    (name): DepRef => ({
      name,
      range: dependencies[name] ?? "unknown",
      dev: false,
    }),
  );
  const dev = Object.keys(devDependencies).map(
    (name): DepRef => ({
      name,
      range: devDependencies[name] ?? "unknown",
      dev: true,
    }),
  );
  const all = [...prod, ...dev];

  const priority = all.filter((d) => isPriority(d.name));
  const rest = all.filter((d) => !isPriority(d.name));
  const ordered: DepRef[] = [];
  const seen = new Set<string>();
  for (const d of [...priority, ...rest]) {
    if (seen.has(d.name)) continue;
    seen.add(d.name);
    ordered.push(d);
    if (ordered.length >= max) break;
  }
  return ordered;
};

/**
 * Read package.json synchronously and produce a compact dependency context with
 * installed versions. Never throws — returns empty summary on any error.
 */
export const buildDependencyContext = (
  cwd: string = process.cwd(),
  maxDependencies: number = 25,
): DependencyContext => {
  try {
    const pkgPath = resolve(cwd, "package.json");
    if (!existsSync(pkgPath)) {
      return { summary: "", depCount: 0, lockfileDetected: false };
    }

    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
    const dependencies = (pkg.dependencies as Record<string, string>) ?? {};
    const devDependencies = (pkg.devDependencies as Record<string, string>) ?? {};

    const lockfiles = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "bun.lock"];
    const lockfileDetected = lockfiles.some((lf) => existsSync(resolve(cwd, lf)));

    const selected = selectDependencies(dependencies, devDependencies, maxDependencies);
    const depEntries = selected.map((d) => {
      const installed = resolveInstalledVersion(cwd, d.name);
      // Prefer the installed version; fall back to the declared range.
      const version = installed ?? `${d.range} (declared)`;
      return `${d.name}@${version}${d.dev ? " (dev)" : ""}`;
    });

    if (depEntries.length === 0) {
      return { summary: "No dependencies found in package.json", depCount: 0, lockfileDetected };
    }

    const name = (pkg.name as string) ?? "unknown";
    const version = (pkg.version as string) ?? "0.0.0";
    const lockLabel = lockfileDetected ? "lockfile present" : "no lockfile";
    const summary =
      `Project: ${name} v${version} (${lockLabel})\n` +
      `Key dependencies (installed versions; "(declared)" = range only, not resolved): ` +
      depEntries.join(", ");

    return { summary, depCount: depEntries.length, lockfileDetected };
  } catch {
    return { summary: "", depCount: 0, lockfileDetected: false };
  }
};
