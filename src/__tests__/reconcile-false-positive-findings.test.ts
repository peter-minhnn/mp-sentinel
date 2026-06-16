/**
 * Tests for the lodash-bundle and hook-placement AI false-positive backstops.
 * Phrasings are taken verbatim from a real gems-e-approval-web review where
 * `useResourceSearch.ts` (a per-method `lodash/debounce` import, correctly under
 * `features/booking/hooks/`) was wrongly flagged on both counts.
 */

import { describe, it, expect } from "@jest/globals";
import {
  reconcileLodashBundleFindings,
  reconcileHookPlacementFindings,
} from "../utils/reconcile-false-positive-findings.js";
import type { AuditIssue, FileAuditResult } from "../types/index.js";

function file(
  filePath: string,
  issues: AuditIssue[],
  status: FileAuditResult["result"]["status"] = "FAIL",
): FileAuditResult {
  return { filePath, duration: 0, result: { status, issues } };
}

const ai = (message: string, severity: AuditIssue["severity"] = "WARNING"): AuditIssue => ({
  line: 1,
  severity,
  category: "performance",
  confidence: "high",
  message,
});

const LODASH_MSG =
  "Importing `debounce` from `lodash/debounce` imports the entire lodash package. Use `lodash-es` or a direct import like `import debounce from 'lodash/debounce'` (which should tree-shake).";
const HOOK_MSG =
  "This hook is not placed in a feature's `hooks/` directory as required by the project structure rules. It should be under `features/<feature>/hooks/` or extracted to a shared location if used across features.";

describe("reconcileLodashBundleFindings", () => {
  const subpathContent = "import debounce from 'lodash/debounce';\nexport const x = debounce;";
  const wholePkgContent = "import _ from 'lodash';\nexport const x = _.debounce;";

  it("drops the lodash-bundle finding when the file only uses a subpath import", () => {
    const { results, suppressed } = reconcileLodashBundleFindings(
      [file("src/features/booking/hooks/useResourceSearch.ts", [ai(LODASH_MSG)])],
      {
        fileContents: new Map([
          ["src/features/booking/hooks/useResourceSearch.ts", subpathContent],
        ]),
      },
    );
    expect(suppressed).toBe(1);
    expect(results[0]!.result.issues).toHaveLength(0);
    expect(results[0]!.result.status).toBe("PASS"); // only actionable finding removed
  });

  it("keeps the finding when the file has a whole-package lodash import", () => {
    const { results, suppressed } = reconcileLodashBundleFindings(
      [file("src/a.ts", [ai(LODASH_MSG)])],
      { fileContents: new Map([["src/a.ts", wholePkgContent]]) },
    );
    expect(suppressed).toBe(0);
    expect(results[0]!.result.issues).toHaveLength(1);
  });

  it("keeps the finding when file content is unavailable (cannot verify)", () => {
    const { suppressed } = reconcileLodashBundleFindings([file("src/a.ts", [ai(LODASH_MSG)])], {
      fileContents: new Map(),
    });
    expect(suppressed).toBe(0);
  });

  it("treats lodash-es imports as already tree-shakeable", () => {
    const { suppressed } = reconcileLodashBundleFindings([file("src/a.ts", [ai(LODASH_MSG)])], {
      fileContents: new Map([["src/a.ts", "import debounce from 'lodash-es/debounce';"]]),
    });
    expect(suppressed).toBe(1);
  });

  it("ignores non-bundle lodash findings", () => {
    const { suppressed } = reconcileLodashBundleFindings(
      [file("src/a.ts", [ai("`_.merge` mutates its first argument; clone it first.")])],
      { fileContents: new Map([["src/a.ts", "import merge from 'lodash/merge';"]]) },
    );
    expect(suppressed).toBe(0);
  });

  it("never touches ESLint-sourced findings", () => {
    const eslint: AuditIssue = { ...ai(LODASH_MSG), evidence: "eslint:import/no-extraneous" };
    const { suppressed } = reconcileLodashBundleFindings([file("src/a.ts", [eslint])], {
      fileContents: new Map([["src/a.ts", "import debounce from 'lodash/debounce';"]]),
    });
    expect(suppressed).toBe(0);
  });
});

describe("reconcileHookPlacementFindings", () => {
  it("drops the misplacement finding when the file is already under hooks/", () => {
    const { results, suppressed } = reconcileHookPlacementFindings([
      file("src/features/booking/hooks/useResourceSearch.ts", [ai(HOOK_MSG, "INFO")]),
    ]);
    expect(suppressed).toBe(1);
    expect(results[0]!.result.issues).toHaveLength(0);
  });

  it("keeps the finding when the file is NOT under a hooks/ directory", () => {
    const { suppressed } = reconcileHookPlacementFindings([
      file("src/features/booking/useResourceSearch.ts", [ai(HOOK_MSG, "INFO")]),
    ]);
    expect(suppressed).toBe(0);
  });

  it("ignores non-hook-placement findings even under hooks/", () => {
    const { suppressed } = reconcileHookPlacementFindings([
      file("src/features/booking/hooks/useResourceSearch.ts", [
        ai("Missing dependency in useEffect array.", "WARNING"),
      ]),
    ]);
    expect(suppressed).toBe(0);
  });

  it("never touches ESLint-sourced findings", () => {
    const eslint: AuditIssue = { ...ai(HOOK_MSG, "INFO"), evidence: "eslint:custom/hook-location" };
    const { suppressed } = reconcileHookPlacementFindings([
      file("src/features/booking/hooks/useResourceSearch.ts", [eslint]),
    ]);
    expect(suppressed).toBe(0);
  });
});
