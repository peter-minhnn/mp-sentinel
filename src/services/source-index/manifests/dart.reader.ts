import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { log } from "../../../utils/logger.js";
import type { ManifestReader } from "./types.js";
import type { ProjectManifest } from "../../../types/index.js";

function detectDartProject(cwd: string): boolean {
  return existsSync(resolve(cwd, "pubspec.yaml"));
}

function parsePubspecYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentSection: string | null = null;
  const sectionDeps: Record<string, Record<string, string>> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Section header: name:, dependencies:, dev_dependencies:
    const sectionMatch = trimmed.match(/^(\w[\w_-]*)\s*:\s*(.*)/);
    if (sectionMatch) {
      const key = sectionMatch[1]!;
      const value = sectionMatch[2]!.trim();
      if (value === "" || value.startsWith("#")) {
        currentSection = key;
      } else {
        result[key] = value.replace(/\s*#.*$/, "");
      }
      continue;
    }

    // Dependency inside a section:   package_name: ^1.0.0
    if (
      currentSection &&
      (currentSection === "dependencies" || currentSection === "dev_dependencies")
    ) {
      const depMatch = trimmed.match(/^(\S+)\s*:\s*(.+)/);
      if (depMatch && depMatch[1] && depMatch[2]) {
        if (!sectionDeps[currentSection]) sectionDeps[currentSection] = {};
        sectionDeps[currentSection]![depMatch[1]!] = depMatch[2]!.replace(/\s*#.*$/, "").trim();
      }
    }
  }

  if (sectionDeps["dependencies"]) result.dependencies = sectionDeps["dependencies"];
  if (sectionDeps["dev_dependencies"]) result.dev_dependencies = sectionDeps["dev_dependencies"];
  return result;
}

function detectFlutterFrameworks(
  deps: Record<string, string>,
  devDeps: Record<string, string>,
): string[] {
  const frameworks: string[] = [];
  const all = { ...deps, ...devDeps };
  if (all["flutter"]) frameworks.push("flutter");
  if (all["flutter_riverpod"] || all["riverpod"]) frameworks.push("riverpod");
  if (all["dio"]) frameworks.push("dio");
  if (all["go_router"]) frameworks.push("go-router");
  return frameworks;
}

export const dartReader: ManifestReader = {
  id: "dart",
  detect: detectDartProject,
  async read(cwd: string): Promise<ProjectManifest> {
    let name: string | undefined;
    let version: string | undefined;
    let deps: Record<string, string> = {};
    let devDeps: Record<string, string> = {};

    try {
      const content = await readFile(resolve(cwd, "pubspec.yaml"), "utf-8");
      const parsed = parsePubspecYaml(content);
      name = parsed.name as string | undefined;
      version = parsed.version as string | undefined;
      deps = (parsed.dependencies as Record<string, string>) ?? {};
      devDeps = (parsed.dev_dependencies as Record<string, string>) ?? {};
    } catch (error) {
      log.warning(
        `Failed to read pubspec.yaml: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return {
      packageName: name,
      packageVersion: version,
      ecosystem: "dart",
      packageManager: "pub",
      dependencies: deps,
      devDependencies: devDeps,
      scripts: {},
      detectedFrameworks: detectFlutterFrameworks(deps, devDeps),
    };
  },
};
