import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { log } from "../../../utils/logger.js";
import type { ManifestReader } from "./types.js";
import type { ProjectManifest } from "../../../types/index.js";

function detectRubyProject(cwd: string): boolean {
  return existsSync(resolve(cwd, "Gemfile"));
}

function parseGemfile(content: string): {
  deps: Record<string, string>;
  devDeps: Record<string, string>;
} {
  const deps: Record<string, string> = {};
  const devDeps: Record<string, string> = {};
  let inGroup: string | null = null;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // group :development, :test do
    const groupMatch = trimmed.match(/^group\s+(.+)\s+do$/);
    if (groupMatch) {
      inGroup = groupMatch[1]!;
      continue;
    }
    if (trimmed === "end") {
      inGroup = null;
      continue;
    }

    // gem 'rails', '~> 7.0'
    const gemMatch = trimmed.match(/^gem\s+["']([^"']+)["'](?:\s*,\s*["']([^"']+)["'])?/);
    if (gemMatch && gemMatch[1]) {
      const name = gemMatch[1]!;
      const version = gemMatch[2] ?? "*";
      if (inGroup && (inGroup.includes("development") || inGroup.includes("test"))) {
        devDeps[name] = version;
      } else {
        deps[name] = version;
      }
    }
  }

  return { deps, devDeps };
}

function detectRubyFrameworks(
  deps: Record<string, string>,
  devDeps: Record<string, string>,
): string[] {
  const frameworks: string[] = [];
  const all = { ...deps, ...devDeps };
  if (all["rails"]) frameworks.push("rails");
  if (all["sinatra"]) frameworks.push("sinatra");
  if (all["hanami"] || all["hanami-router"]) frameworks.push("hanami");
  if (all["rspec"] || all["rspec-rails"]) frameworks.push("rspec");
  if (all["minitest"]) frameworks.push("minitest");
  return frameworks;
}

export const rubyReader: ManifestReader = {
  id: "ruby",
  detect: detectRubyProject,
  async read(cwd: string): Promise<ProjectManifest> {
    const result = { deps: {} as Record<string, string>, devDeps: {} as Record<string, string> };

    try {
      const content = await readFile(resolve(cwd, "Gemfile"), "utf-8");
      const parsed = parseGemfile(content);
      result.deps = parsed.deps;
      result.devDeps = parsed.devDeps;
    } catch (error) {
      log.warning(
        `Failed to read Gemfile: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return {
      packageName: undefined,
      packageVersion: undefined,
      ecosystem: "ruby",
      packageManager: "bundler",
      dependencies: result.deps,
      devDependencies: result.devDeps,
      scripts: {},
      detectedFrameworks: detectRubyFrameworks(result.deps, result.devDeps),
    };
  },
};
