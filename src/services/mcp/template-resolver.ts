/**
 * Template variable resolution for MCP call input values.
 * Supported variables:
 *   ${repo.owner}       → metadata.owner
 *   ${repo.name}        → metadata.name
 *   ${repo.fullName}    → metadata.fullName
 *   ${pr.number}        → String(metadata.prNumber)
 *   ${head.sha}         → metadata.headSha
 *   ${base.ref}         → metadata.baseRef
 *   ${changedFiles.csv} → metadata.changedFilesCsv
 *   ${cwd}              → workingDir
 *
 * Unknown template vars are left as-is with a debug warning.
 * Recursively walks objects and arrays.
 */

import type { PRMetadata } from "../../utils/pr-metadata.js";
import { log } from "../../utils/logger.js";

const VAR_PATTERN = /\$\{([^}]+)\}/g;

type Metadata = PRMetadata & { changedFilesCsv: string };

export const resolveTemplateVariables = (
  input: Record<string, unknown>,
  metadata: Metadata,
  workingDir: string,
): Record<string, unknown> => {
  const replacers: Record<string, string> = {
    "repo.owner": metadata.owner,
    "repo.name": metadata.name,
    "repo.fullName": metadata.fullName,
    "pr.number": String(metadata.prNumber),
    "head.sha": metadata.headSha,
    "base.ref": metadata.baseRef,
    "changedFiles.csv": metadata.changedFilesCsv,
    cwd: workingDir,
  };

  const resolveValue = (value: unknown): unknown => {
    if (typeof value === "string") {
      return value.replaceAll(VAR_PATTERN, (_match, name: string) => {
        if (name in replacers) {
          return replacers[name]!;
        }
        log.debug(`Unknown MCP template variable: \${${name}}`);
        return `\${${name}}`;
      });
    }
    if (Array.isArray(value)) {
      return value.map(resolveValue);
    }
    if (value !== null && typeof value === "object") {
      const resolved: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        resolved[k] = resolveValue(v);
      }
      return resolved;
    }
    return value;
  };

  return resolveValue(input) as Record<string, unknown>;
};
