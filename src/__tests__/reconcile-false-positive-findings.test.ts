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
  reconcileUnusedJsxFindings,
  reconcileAntdIconImportFindings,
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

describe("reconcileUnusedJsxFindings", () => {
  // Modeled on the real BookingDetailModal.tsx false positives: components that
  // are clearly rendered were flagged as "Unused JSX element".
  const bookingDetailModal = [
    "export function BookingDetailModal() {",
    "  return (",
    "    <Modal>",
    "      <CancelBookingModal />",
    "      <EditOccurrenceModal />",
    "      <EditBookingChoiceModal />",
    "    </Modal>",
    "  );",
    "}",
  ].join("\n");

  const at = (line: number, message: string): AuditIssue => ({
    line,
    severity: "WARNING",
    category: "maintainability",
    confidence: "medium",
    message,
  });

  it("drops 'unused JSX element' findings for components actually rendered", () => {
    const issues = [
      at(3, "Unused JSX element `<Modal>` — consider removing it."),
      at(4, "Unused JSX element `<CancelBookingModal>` is never used."),
      at(5, "Unused component `<EditOccurrenceModal>`."),
      at(6, "Unused JSX element `<EditBookingChoiceModal>`."),
    ];
    const { results, suppressed } = reconcileUnusedJsxFindings(
      [file("src/components/BookingDetailModal.tsx", issues)],
      { fileContents: new Map([["src/components/BookingDetailModal.tsx", bookingDetailModal]]) },
    );
    expect(suppressed).toBe(4);
    expect(results[0]!.result.issues).toHaveLength(0);
    expect(results[0]!.result.status).toBe("PASS");
  });

  it("drops a generic 'unused JSX element' when its own line is a JSX tag", () => {
    const { suppressed } = reconcileUnusedJsxFindings(
      [file("src/components/BookingDetailModal.tsx", [at(4, "Unused JSX element detected.")])],
      { fileContents: new Map([["src/components/BookingDetailModal.tsx", bookingDetailModal]]) },
    );
    expect(suppressed).toBe(1);
  });

  it("keeps an 'unused JSX prop/attribute' finding even on a JSX line", () => {
    const issues = [
      at(4, "Unused JSX prop `onCancel` passed to `<CancelBookingModal>` is never read."),
      at(5, "Unused attribute `data-test` on this element."),
      at(6, "Unused event handler `onConfirm`."),
    ];
    const { suppressed, results } = reconcileUnusedJsxFindings(
      [file("src/components/BookingDetailModal.tsx", issues)],
      { fileContents: new Map([["src/components/BookingDetailModal.tsx", bookingDetailModal]]) },
    );
    expect(suppressed).toBe(0);
    expect(results[0]!.result.issues).toHaveLength(3);
  });

  it("keeps a real unused-import finding (declaration, not a rendered tag)", () => {
    const content = "import { Helper } from './helper';\nexport const x = 1;\n";
    const { suppressed } = reconcileUnusedJsxFindings(
      [file("src/a.tsx", [at(1, "Unused import `Helper` — the component is never used in JSX.")])],
      { fileContents: new Map([["src/a.tsx", content]]) },
    );
    expect(suppressed).toBe(0);
  });

  it("keeps the finding when file content is unavailable", () => {
    const { suppressed } = reconcileUnusedJsxFindings(
      [file("src/a.tsx", [at(4, "Unused JSX element `<Modal>`.")])],
      { fileContents: new Map() },
    );
    expect(suppressed).toBe(0);
  });

  it("never touches ESLint-sourced findings", () => {
    const eslint: AuditIssue = {
      ...at(4, "Unused JSX element `<Modal>`."),
      evidence: "eslint:react/no-unused",
    };
    const { suppressed } = reconcileUnusedJsxFindings([file("src/a.tsx", [eslint])], {
      fileContents: new Map([["src/a.tsx", bookingDetailModal]]),
    });
    expect(suppressed).toBe(0);
  });
});

describe("reconcileAntdIconImportFindings", () => {
  const at = (line: number, message: string): AuditIssue => ({
    line,
    severity: "WARNING",
    category: "architecture",
    confidence: "medium",
    message,
  });
  const ICON_MSG =
    "Import icons from the gems-ui barrel (`@/shared/gems-ui`) instead of directly from `@ant-design/icons`.";
  const iconSource =
    "import { SearchOutlined } from '@ant-design/icons';\nexport const x = SearchOutlined;";

  it("drops the gems-ui barrel finding for an @ant-design/icons import", () => {
    const { results, suppressed } = reconcileAntdIconImportFindings(
      [file("src/components/Search.tsx", [at(1, ICON_MSG)])],
      { fileContents: new Map([["src/components/Search.tsx", iconSource]]) },
    );
    expect(suppressed).toBe(1);
    expect(results[0]!.result.issues).toHaveLength(0);
  });

  it("keeps a direct antd component import finding", () => {
    const antdMsg =
      "Import UI components from the gems-ui barrel (`@/shared/gems-ui`) instead of directly from `antd`.";
    const src = "import { Button, Modal } from 'antd';\nexport const x = Button;";
    const { suppressed } = reconcileAntdIconImportFindings(
      [file("src/components/Form.tsx", [at(1, antdMsg)])],
      { fileContents: new Map([["src/components/Form.tsx", src]]) },
    );
    expect(suppressed).toBe(0);
  });

  it("keeps the finding when the file does not actually import @ant-design/icons", () => {
    const { suppressed } = reconcileAntdIconImportFindings([file("src/a.tsx", [at(1, ICON_MSG)])], {
      fileContents: new Map([["src/a.tsx", "export const x = 1;"]]),
    });
    expect(suppressed).toBe(0);
  });

  it("never touches ESLint-sourced findings", () => {
    const eslint: AuditIssue = { ...at(1, ICON_MSG), evidence: "eslint:no-restricted-imports" };
    const { suppressed } = reconcileAntdIconImportFindings(
      [file("src/components/Search.tsx", [eslint])],
      {
        fileContents: new Map([["src/components/Search.tsx", iconSource]]),
      },
    );
    expect(suppressed).toBe(0);
  });
});
