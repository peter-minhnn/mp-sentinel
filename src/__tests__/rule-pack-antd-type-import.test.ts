/**
 * Tests for the antd/antd-type-import deterministic evaluator. Field source:
 * review-0706.md — `import { TableProps } from 'antd'` (RoomsManagement.tsx,
 * CarManagement.tsx, MyBookingsContent.tsx) was not flagged as a value import
 * of a type. The rule is precision-first: only AntD names that are
 * unambiguously types (suffix `Props`/`Type` or a known set) are flagged, and
 * only when the pack is active (antd in deps).
 */

import { describe, it, expect } from "@jest/globals";
import { evaluateChangedFiles } from "../services/skills-generator/rule-packs/evaluator.js";
import type { RulePackContext } from "../services/skills-generator/rule-packs/index.js";

function ctx(deps?: Record<string, string>): RulePackContext {
  return {
    langProfile: {
      dominant: "typescript",
      secondary: [],
      distribution: { typescript: 1 },
      indexableShare: 1,
      nonIndexableHotspots: [],
    },
    frameworks: [],
    deps: deps ?? { antd: "6.0.0" },
  };
}

function findings(files: Record<string, string>, deps?: Record<string, string>) {
  return evaluateChangedFiles(ctx(deps), { files: new Map(Object.entries(files)) }).filter(
    (f) => f.ruleId === "antd/antd-type-import",
  );
}

describe("antd/antd-type-import evaluator", () => {
  it("flags a `*Props` type imported as a value", () => {
    const out = findings({ "RoomsManagement.tsx": "import { TableProps } from 'antd';" });
    expect(out).toHaveLength(1);
    expect(out[0]!.issue.severity).toBe("INFO");
    expect(out[0]!.issue.message).toContain("TableProps");
  });

  it("flags a known non-suffix type (`UploadFile`) and reports mixed imports", () => {
    const out = findings({
      "Upload.tsx": "import { Upload, UploadFile, message } from 'antd';",
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.issue.message).toContain("UploadFile");
    // Runtime values are not named in the finding.
    expect(out[0]!.issue.message).not.toContain("`Upload`");
    expect(out[0]!.issue.message).not.toContain("message");
  });

  it("does NOT flag runtime value imports", () => {
    const out = findings({
      "Ok.tsx": "import { Table, Button, Form, message, theme } from 'antd';",
    });
    expect(out).toHaveLength(0);
  });

  it("does NOT flag an already type-only import", () => {
    const out = findings({ "Ok.tsx": "import type { TableProps } from 'antd';" });
    expect(out).toHaveLength(0);
  });

  it("does NOT flag an inline `type` modifier specifier", () => {
    const out = findings({ "Ok.tsx": "import { Table, type TableProps } from 'antd';" });
    expect(out).toHaveLength(0);
  });

  it("handles a default import alongside named type specifiers", () => {
    const out = findings({ "Ok.tsx": "import React, { FormInstance } from 'antd';" });
    expect(out).toHaveLength(1);
    expect(out[0]!.issue.message).toContain("FormInstance");
  });

  it("resolves the imported name through an alias", () => {
    const out = findings({ "Ok.tsx": "import { TableProps as TP } from 'antd';" });
    expect(out).toHaveLength(1);
    expect(out[0]!.issue.message).toContain("TableProps");
  });

  it("ignores type imports from non-antd modules", () => {
    const out = findings({ "Ok.tsx": "import { TableProps } from './local';" });
    expect(out).toHaveLength(0);
  });

  it("stays silent when the antd pack is inactive (no antd dep)", () => {
    const out = findings({ "RoomsManagement.tsx": "import { TableProps } from 'antd';" }, {});
    expect(out).toHaveLength(0);
  });

  it("respects an eslint-disable opt-out", () => {
    const out = findings({
      "Ok.tsx": "// eslint-disable-next-line\nimport { TableProps } from 'antd';",
    });
    expect(out).toHaveLength(0);
  });
});
