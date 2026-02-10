/**
 * CLI Argument Parsing
 * Parses and validates command-line arguments for mp-sentinel
 */

import { parseArgs } from "node:util";

/**
 * Parsed CLI option values
 */
export interface CLIValues {
  help: boolean;
  version: boolean;
  "skip-commit": boolean;
  "skip-files": boolean;
  "target-branch"?: string;
  concurrency: string;
  verbose: boolean;
  /** Enable local review mode - review commits directly on current branch */
  local: boolean;
  /** Number of recent commits to review in local mode (default: from config or 1) */
  commits: string;
  /** Enable branch diff mode - get all commits that differ from compare-branch */
  "branch-diff": boolean;
  /** Target branch to compare against for branch-diff mode (default: origin/main) */
  "compare-branch"?: string;
}

/**
 * Default CLI values used when argument parsing fails
 */
const DEFAULT_VALUES: CLIValues = {
  help: false,
  version: false,
  "skip-commit": false,
  "skip-files": false,
  concurrency: "5",
  verbose: false,
  local: false,
  commits: "1",
  "branch-diff": false,
};

/**
 * Parse CLI arguments with error recovery
 * Returns defaults if parsing fails (e.g., unknown flags)
 */
export const parseCliArgs = (): {
  values: CLIValues;
  positionals: string[];
} => {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
        "skip-commit": { type: "boolean", default: false },
        "skip-files": { type: "boolean", default: false },
        "target-branch": { type: "string", short: "b" },
        concurrency: { type: "string", short: "c", default: "5" },
        verbose: { type: "boolean", default: false },
        // Local review mode options
        local: { type: "boolean", short: "l", default: false },
        commits: { type: "string", short: "n", default: "1" },
        // Branch diff mode options
        "branch-diff": { type: "boolean", short: "d", default: false },
        "compare-branch": { type: "string" },
      },
    });
    return { values: values as CLIValues, positionals };
  } catch {
    return {
      values: { ...DEFAULT_VALUES },
      positionals: [],
    };
  }
};
