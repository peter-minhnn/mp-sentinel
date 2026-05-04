/**
 * Dependency/Version context for review prompts.
 *
 * Builds a compact summary of project dependencies and their versions
 * from package.json and lockfile identity. No live network calls.
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
 * Read package.json synchronously and produce a compact dependency context.
 * Never throws — returns empty summary on any error.
 */
export const buildDependencyContext = (
  cwd: string = process.cwd(),
  maxDependencies: number = 20,
): DependencyContext => {
  try {
    const pkgPath = resolve(cwd, "package.json");
    if (!existsSync(pkgPath)) {
      return { summary: "", depCount: 0, lockfileDetected: false };
    }

    const raw = readFileSync(pkgPath, "utf-8");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const pkg: Record<string, unknown> = JSON.parse(raw);

    const dependencies: Record<string, string> = (pkg.dependencies as Record<string, string>) ?? {};
    const devDependencies: Record<string, string> =
      (pkg.devDependencies as Record<string, string>) ?? {};

    // Detect lockfile
    const lockfiles = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb"];
    const lockfileDetected = lockfiles.some((lf) => existsSync(resolve(cwd, lf)));

    // Collect production deps (up to maxDependencies)
    const depEntries: string[] = [];
    // Top 10 prod deps
    const prodKeys = Object.keys(dependencies).slice(0, maxDependencies);
    for (const name of prodKeys) {
      const ver = dependencies[name] ?? "unknown";
      depEntries.push(`${name}@${ver}`);
    }

    // Top 5 dev deps
    const devKeys = Object.keys(devDependencies).slice(0, 5);
    for (const name of devKeys) {
      const ver = devDependencies[name] ?? "unknown";
      depEntries.push(`${name}@${ver} (dev)`);
    }

    if (depEntries.length === 0) {
      return {
        summary: "No dependencies found in package.json",
        depCount: 0,
        lockfileDetected,
      };
    }

    const name = (pkg.name as string) ?? "unknown";
    const version = (pkg.version as string) ?? "0.0.0";
    const lockLabel = lockfileDetected ? "lockfile present" : "no lockfile";

    const summary = `Project: ${name} v${version} (${lockLabel})\nKey dependencies: ${depEntries.join(", ")}`;

    return {
      summary,
      depCount: depEntries.length,
      lockfileDetected,
    };
  } catch {
    return { summary: "", depCount: 0, lockfileDetected: false };
  }
};
