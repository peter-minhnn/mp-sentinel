/**
 * Unit tests for severity-threshold resolution and the FAIL predicate.
 */

import { describe, expect, it } from "@jest/globals";
import {
  DEFAULT_SEVERITY_THRESHOLD,
  issuesFailThreshold,
  parseSeverityThreshold,
  resolveSeverityThreshold,
} from "../utils/severity.js";
import type { AuditIssue, ProjectConfig } from "../types/index.js";

const issue = (severity: AuditIssue["severity"]): AuditIssue => ({
  line: 1,
  severity,
  message: "test",
});

describe("parseSeverityThreshold", () => {
  it("accepts canonical uppercase values", () => {
    expect(parseSeverityThreshold("CRITICAL")).toBe("CRITICAL");
    expect(parseSeverityThreshold("WARNING")).toBe("WARNING");
    expect(parseSeverityThreshold("INFO")).toBe("INFO");
  });

  it("normalizes case-insensitively", () => {
    expect(parseSeverityThreshold("critical")).toBe("CRITICAL");
    expect(parseSeverityThreshold("  Warning  ")).toBe("WARNING");
  });

  it("throws UserError on invalid input", () => {
    expect(() => parseSeverityThreshold("HIGH")).toThrow(/Invalid severity threshold/);
    expect(() => parseSeverityThreshold("")).toThrow(/Invalid severity threshold/);
  });
});

describe("resolveSeverityThreshold", () => {
  const emptyConfig: ProjectConfig = {};

  it("defaults to WARNING when nothing is set", () => {
    expect(resolveSeverityThreshold({ config: emptyConfig })).toBe(DEFAULT_SEVERITY_THRESHOLD);
    expect(DEFAULT_SEVERITY_THRESHOLD).toBe("WARNING");
  });

  it("uses config baseline when no CLI flag and no branch match", () => {
    const cfg: ProjectConfig = { review: { severityThreshold: "CRITICAL" } };
    expect(resolveSeverityThreshold({ config: cfg })).toBe("CRITICAL");
  });

  it("CLI flag overrides config baseline", () => {
    const cfg: ProjectConfig = { review: { severityThreshold: "CRITICAL" } };
    expect(resolveSeverityThreshold({ config: cfg, cliFlag: "INFO" })).toBe("INFO");
  });

  it("branch override beats baseline", () => {
    const cfg: ProjectConfig = {
      review: {
        severityThreshold: "CRITICAL",
        protectedBranches: { main: "WARNING" },
      },
    };
    expect(resolveSeverityThreshold({ config: cfg, currentBranch: "main" })).toBe("WARNING");
  });

  it("CLI flag still wins over branch override", () => {
    const cfg: ProjectConfig = {
      review: { protectedBranches: { main: "WARNING" } },
    };
    expect(resolveSeverityThreshold({ config: cfg, currentBranch: "main", cliFlag: "INFO" })).toBe(
      "INFO",
    );
  });

  it("ignores branch override when branch name does not match", () => {
    const cfg: ProjectConfig = {
      review: {
        severityThreshold: "CRITICAL",
        protectedBranches: { main: "WARNING" },
      },
    };
    expect(resolveSeverityThreshold({ config: cfg, currentBranch: "feature/x" })).toBe("CRITICAL");
  });
});

describe("issuesFailThreshold", () => {
  it("returns false for no issues", () => {
    expect(issuesFailThreshold(undefined, "WARNING")).toBe(false);
    expect(issuesFailThreshold([], "WARNING")).toBe(false);
  });

  describe("CRITICAL threshold", () => {
    it("fails on CRITICAL", () => {
      expect(issuesFailThreshold([issue("CRITICAL")], "CRITICAL")).toBe(true);
    });
    it("ignores WARNING and INFO", () => {
      expect(issuesFailThreshold([issue("WARNING"), issue("INFO")], "CRITICAL")).toBe(false);
    });
  });

  describe("WARNING threshold (default)", () => {
    it("fails on CRITICAL or WARNING", () => {
      expect(issuesFailThreshold([issue("CRITICAL")], "WARNING")).toBe(true);
      expect(issuesFailThreshold([issue("WARNING")], "WARNING")).toBe(true);
    });
    it("ignores INFO-only", () => {
      expect(issuesFailThreshold([issue("INFO"), issue("INFO")], "WARNING")).toBe(false);
    });
  });

  describe("INFO threshold", () => {
    it("fails on any severity", () => {
      expect(issuesFailThreshold([issue("INFO")], "INFO")).toBe(true);
      expect(issuesFailThreshold([issue("WARNING")], "INFO")).toBe(true);
      expect(issuesFailThreshold([issue("CRITICAL")], "INFO")).toBe(true);
    });
  });
});
