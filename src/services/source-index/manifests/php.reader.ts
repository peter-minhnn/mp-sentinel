import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { log } from "../../../utils/logger.js";
import type { ManifestReader } from "./types.js";
import type { ProjectManifest } from "../../../types/index.js";

function detectPhpProject(cwd: string): boolean {
  return existsSync(resolve(cwd, "composer.json"));
}

function readComposerJson(cwd: string): {
  name: string | undefined;
  deps: Record<string, string>;
  devDeps: Record<string, string>;
  scripts: Record<string, string>;
} {
  const result = {
    name: undefined as string | undefined,
    deps: {} as Record<string, string>,
    devDeps: {} as Record<string, string>,
    scripts: {} as Record<string, string>,
  };
  const path = resolve(cwd, "composer.json");
  if (!existsSync(path)) return result;
  try {
    const content = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    result.name = content.name as string | undefined;
    const require = content.require as Record<string, string> | undefined;
    if (require) result.deps = require;
    const requireDev = content["require-dev"] as Record<string, string> | undefined;
    if (requireDev) result.devDeps = requireDev;
    const scripts = content.scripts as Record<string, string> | undefined;
    if (scripts) result.scripts = scripts;
  } catch (error) {
    log.warning(
      `Failed to read composer.json: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return result;
}

function detectPhpFrameworks(deps: Record<string, string>): string[] {
  const frameworks: string[] = [];
  if (deps["laravel/framework"]) frameworks.push("laravel");
  if (deps["symfony/http-kernel"] || deps["symfony/framework-bundle"]) frameworks.push("symfony");
  if (deps["cakephp/cakephp"]) frameworks.push("cakephp");
  if (deps["codeigniter/framework"]) frameworks.push("codeigniter");
  if (deps["yiisoft/yii2"]) frameworks.push("yii");
  if (deps["phpunit/phpunit"]) frameworks.push("phpunit");
  if (deps["pestphp/pest"]) frameworks.push("pest");
  return frameworks;
}

export const phpReader: ManifestReader = {
  id: "php",
  detect: detectPhpProject,
  async read(cwd: string): Promise<ProjectManifest> {
    const info = readComposerJson(cwd);
    return {
      packageName: info.name,
      packageVersion: undefined,
      ecosystem: "php",
      packageManager: "composer",
      dependencies: info.deps,
      devDependencies: info.devDeps,
      scripts: info.scripts,
      detectedFrameworks: detectPhpFrameworks(info.deps),
    };
  },
};
