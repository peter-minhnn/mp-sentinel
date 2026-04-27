import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface PackageMetadata {
  name?: string;
  version?: string;
}

const FALLBACK_VERSION = "0.0.0-dev";
const PACKAGE_NAME = "mp-sentinel";

function readPackageVersion(packagePath: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(packagePath, "utf-8")) as PackageMetadata;
    if (parsed.name === PACKAGE_NAME && typeof parsed.version === "string") {
      return parsed.version;
    }
  } catch {
    return null;
  }
  return null;
}

export function getToolVersion(): string {
  const envVersion = process.env["npm_package_version"];
  if (envVersion) return envVersion;

  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const packageCandidates = [
    resolve(moduleDir, "../package.json"), // bundled dist/index.js or dist/lib.js
    resolve(moduleDir, "../../package.json"), // source src/utils/version.ts under tsx
  ];

  for (const packagePath of packageCandidates) {
    const version = readPackageVersion(packagePath);
    if (version) return version;
  }

  return FALLBACK_VERSION;
}
