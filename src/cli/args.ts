/**
 * CLI Argument Parsing
 * Parses and validates command-line arguments for mp-sentinel
 */

import { parseArgs } from "node:util";
import { UserError } from "../utils/errors.js";

export type CLICommand = "review" | "default";

/**
 * Parsed CLI option values
 */
export interface CLIValues {
  help: boolean;
  version: boolean;
  "skip-commit": boolean;
  "skip-files": boolean;
  "target-branch"?: string;
  concurrency?: string;
  verbose: boolean;
  /** Enable local review mode - review commits directly on current branch */
  local: boolean;
  /** Number of recent commits to review in local mode (default: from config or 1) */
  commits: string;
  /** Enable branch diff mode - get all commits that differ from compare-branch */
  "branch-diff": boolean;
  /** Target branch to compare against for branch-diff mode (default: origin/main) */
  "compare-branch"?: string;
  /** Review target: staged files */
  staged: boolean;
  /** Review target: single commit SHA */
  commit?: string;
  /** Review target: git range base..head */
  range?: string;
  /** Review target: explicit file list */
  files: string[];
  /** Output format */
  format?: string;
  /** Explicit AI toggle (tri-state through env/config resolution) */
  ai?: boolean;
}

/**
 * Parse CLI arguments.
 */
export const parseCliArgs = (): {
  command: CLICommand;
  values: CLIValues;
  positionals: string[];
  commandPositionals: string[];
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
        concurrency: { type: "string", short: "c" },
        verbose: { type: "boolean", default: false },
        // Local review mode options
        local: { type: "boolean", short: "l", default: false },
        commits: { type: "string", short: "n", default: "1" },
        // Branch diff mode options
        "branch-diff": { type: "boolean", short: "d", default: false },
        "compare-branch": { type: "string" },
        // Stable review command options
        staged: { type: "boolean", default: false },
        commit: { type: "string" },
        range: { type: "string" },
        files: { type: "string", multiple: true },
        format: { type: "string" },
        ai: { type: "boolean" },
      },
    });
    const rawPositionals = [...positionals];
    const command: CLICommand = rawPositionals[0] === "review" ? "review" : "default";
    const commandPositionals =
      command === "review" ? rawPositionals.slice(1) : rawPositionals;

    return {
      command,
      values: values as CLIValues,
      positionals: rawPositionals,
      commandPositionals,
    };
  } catch (error) {
    const fallbackMessage =
      error instanceof Error ? error.message : "Invalid arguments";
    throw new UserError(
      `Invalid arguments: ${fallbackMessage}. Run "mp-sentinel --help" for usage.`,
    );
  }
};
