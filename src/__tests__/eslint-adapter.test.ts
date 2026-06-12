/**
 * Tests for the ESLint adapter (fail-open behavioral contract).
 *
 * Matrix:
 *  - mapping: severity levels, CRITICAL whitelist, overrides, categories
 *  - fatal (ruleId: null) messages are skipped
 *  - disabled config / no lintable files → null without spawning
 *  - exec failure without stdout → null (fail-open)
 *  - exec exit 1 with JSON on stdout → findings parsed
 *  - malformed JSON → null (fail-open)
 */

import { describe, it, expect } from "@jest/globals";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  mapESLintOutput,
  runESLintAdapter,
  categoryForRule,
  type ESLintExec,
  type ESLintFileResult,
} from "../services/eslint-adapter.js";
import type { ProjectConfig } from "../types/index.js";

const enabledConfig: ProjectConfig = { eslint: { enabled: true } };

/** Create a temp project dir with an ESLint config so the probe passes. */
const makeProjectDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "eslint-adapter-test-"));
  writeFileSync(join(dir, "eslint.config.js"), "export default [];\n");
  return dir;
};

const eslintJson = (filePath: string): ESLintFileResult[] => [
  {
    filePath,
    messages: [
      {
        ruleId: "react-hooks/rules-of-hooks",
        severity: 2,
        message: "Hook called conditionally",
        line: 10,
      },
      { ruleId: "no-console", severity: 1, message: "Unexpected console statement", line: 20 },
    ],
  },
];

describe("mapESLintOutput", () => {
  const abs = new Map([["/repo/src/App.tsx", "src/App.tsx"]]);

  it("maps ESLint severity 2 → WARNING and 1 → INFO", () => {
    const result = mapESLintOutput(
      [
        {
          filePath: "/repo/src/App.tsx",
          messages: [
            { ruleId: "eqeqeq", severity: 2, message: "Expected ===", line: 3 },
            { ruleId: "no-console", severity: 1, message: "Unexpected console", line: 4 },
          ],
        },
      ],
      abs,
    );
    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.path).toBe("src/App.tsx");
    expect(result.files[0]!.issues[0]!.severity).toBe("WARNING");
    expect(result.files[0]!.issues[1]!.severity).toBe("INFO");
    expect(result.totalWarning).toBe(1);
    expect(result.totalInfo).toBe(1);
    expect(result.hasCriticalFindings).toBe(false);
  });

  it("escalates whitelisted crash-prone rules to CRITICAL", () => {
    const result = mapESLintOutput(eslintJson("/repo/src/App.tsx"), abs);
    const hookIssue = result.files[0]!.issues.find((i) => i.evidence?.includes("rules-of-hooks"));
    expect(hookIssue?.severity).toBe("CRITICAL");
    expect(hookIssue?.category).toBe("runtime-crash");
    expect(result.hasCriticalFindings).toBe(true);
  });

  it("lets config severityOverrides win over whitelist and levels", () => {
    const result = mapESLintOutput(eslintJson("/repo/src/App.tsx"), abs, {
      "react-hooks/rules-of-hooks": "INFO",
      "no-console": "CRITICAL",
    });
    const issues = result.files[0]!.issues;
    expect(issues.find((i) => i.evidence === "eslint:react-hooks/rules-of-hooks")?.severity).toBe(
      "INFO",
    );
    expect(issues.find((i) => i.evidence === "eslint:no-console")?.severity).toBe("CRITICAL");
  });

  it("skips fatal messages (ruleId null) and files without findings", () => {
    const result = mapESLintOutput(
      [
        {
          filePath: "/repo/src/App.tsx",
          messages: [{ ruleId: null, severity: 2, message: "Parsing error", line: 1 }],
        },
        { filePath: "/repo/src/Other.tsx", messages: [] },
      ],
      abs,
    );
    expect(result.files).toHaveLength(0);
    expect(result.totalCritical + result.totalWarning + result.totalInfo).toBe(0);
  });

  it("defaults missing line numbers to 1", () => {
    const result = mapESLintOutput(
      [
        {
          filePath: "/repo/src/App.tsx",
          messages: [{ ruleId: "eqeqeq", severity: 2, message: "Expected ===" }],
        },
      ],
      abs,
    );
    expect(result.files[0]!.issues[0]!.line).toBe(1);
  });
});

describe("categoryForRule", () => {
  it("maps known rules and prefixes to rubric categories", () => {
    expect(categoryForRule("react-hooks/rules-of-hooks")).toBe("runtime-crash");
    expect(categoryForRule("react-hooks/exhaustive-deps")).toBe("performance");
    expect(categoryForRule("@typescript-eslint/no-floating-promises")).toBe("runtime-crash");
    expect(categoryForRule("no-await-in-loop")).toBe("performance");
    expect(categoryForRule("security/detect-object-injection")).toBe("security");
    expect(categoryForRule("eqeqeq")).toBe("maintainability");
  });
});

describe("runESLintAdapter", () => {
  it("returns null when the adapter is not enabled", async () => {
    let called = false;
    const execImpl: ESLintExec = async () => {
      called = true;
      return { stdout: "[]" };
    };
    const result = await runESLintAdapter(["src/a.ts"], {}, makeProjectDir(), execImpl);
    expect(result).toBeNull();
    expect(called).toBe(false);
  });

  it("returns null when no lintable files are in scope", async () => {
    let called = false;
    const execImpl: ESLintExec = async () => {
      called = true;
      return { stdout: "[]" };
    };
    const result = await runESLintAdapter(
      ["README.md", "styles.css"],
      enabledConfig,
      makeProjectDir(),
      execImpl,
    );
    expect(result).toBeNull();
    expect(called).toBe(false);
  });

  it("returns null (fail-open) when no ESLint config exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eslint-adapter-noconfig-"));
    const execImpl: ESLintExec = async () => ({ stdout: "[]" });
    const result = await runESLintAdapter(["src/a.ts"], enabledConfig, dir, execImpl);
    expect(result).toBeNull();
  });

  it("returns null (fail-open) when the process fails without stdout", async () => {
    const execImpl: ESLintExec = async () => {
      throw new Error("spawn npx ENOENT");
    };
    const result = await runESLintAdapter(["src/a.ts"], enabledConfig, makeProjectDir(), execImpl);
    expect(result).toBeNull();
  });

  it("parses findings when ESLint exits 1 with JSON on stdout", async () => {
    const dir = makeProjectDir();
    const absPath = resolve(dir, "src/a.ts");
    const execImpl: ESLintExec = async () => {
      const err = new Error("Command failed (exit 1)") as Error & { stdout?: string };
      err.stdout = JSON.stringify(eslintJson(absPath));
      throw err;
    };
    const result = await runESLintAdapter(["src/a.ts"], enabledConfig, dir, execImpl);
    expect(result).not.toBeNull();
    expect(result!.files[0]!.path).toBe("src/a.ts");
    expect(result!.totalCritical).toBe(1);
    expect(result!.totalInfo).toBe(1);
  });

  it("returns null (fail-open) on malformed JSON output", async () => {
    const execImpl: ESLintExec = async () => ({ stdout: "Oops, not JSON {" });
    const result = await runESLintAdapter(["src/a.ts"], enabledConfig, makeProjectDir(), execImpl);
    expect(result).toBeNull();
  });

  it("maps absolute ESLint paths back to repo-relative paths", async () => {
    const dir = makeProjectDir();
    const absPath = resolve(dir, "src/deep/nested/file.tsx");
    const execImpl: ESLintExec = async () => ({
      stdout: JSON.stringify([
        {
          filePath: absPath,
          messages: [{ ruleId: "eqeqeq", severity: 2, message: "Expected ===", line: 7 }],
        },
      ]),
    });
    const result = await runESLintAdapter(
      ["src/deep/nested/file.tsx"],
      enabledConfig,
      dir,
      execImpl,
    );
    expect(result!.files[0]!.path).toBe("src/deep/nested/file.tsx");
  });
});
