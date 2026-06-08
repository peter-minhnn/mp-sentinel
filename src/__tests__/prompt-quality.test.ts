/**
 * Prompt quality and context tests.
 *
 * Verifies that the system prompt includes the mandatory rubric,
 * dependency/version context, and that local skills/rules remain highest priority.
 */

import { describe, it, expect } from "@jest/globals";
import { BASE_AUDIT_PROMPT, DEFAULT_PROMPT_VERSION } from "../config/prompts.js";
import { buildDependencyContext } from "../services/dependency-context.js";
import { parseAuditResponse } from "../utils/parser.js";

// ── Rubric tests ──────────────────────────────────────────────────────────

describe("Base audit prompt — mandatory rubric", () => {
  it("contains security category", () => {
    expect(BASE_AUDIT_PROMPT).toMatch(/security/);
  });

  it("contains runtime-crash category", () => {
    expect(BASE_AUDIT_PROMPT).toMatch(/runtime-crash/);
  });

  it("contains architecture category", () => {
    expect(BASE_AUDIT_PROMPT).toMatch(/architecture/);
  });

  it("contains dependency-version category", () => {
    expect(BASE_AUDIT_PROMPT).toMatch(/dependency-version/);
  });

  it("contains test-gap category", () => {
    expect(BASE_AUDIT_PROMPT).toMatch(/test-gap/);
  });

  it("contains performance category", () => {
    expect(BASE_AUDIT_PROMPT).toMatch(/performance/);
  });

  it("contains maintainability category", () => {
    expect(BASE_AUDIT_PROMPT).toMatch(/maintainability/);
  });

  it("contains MANDATORY RUBRIC header", () => {
    expect(BASE_AUDIT_PROMPT).toMatch(/MANDATORY RUBRIC/);
  });

  it("contains priority instructions", () => {
    expect(BASE_AUDIT_PROMPT).toMatch(/PRIORITIES/);
  });

  it("instructs to prioritize exploitability", () => {
    expect(BASE_AUDIT_PROMPT).toMatch(/exploitability/);
  });

  it("instructs to prioritize crash paths", () => {
    expect(BASE_AUDIT_PROMPT).toMatch(/crash paths/);
  });

  it("instructs not to claim unsupported certainty", () => {
    expect(BASE_AUDIT_PROMPT).toMatch(/do not claim unsupported certainty/);
  });
});

// ── False-positive guardrail tests ─────────────────────────────────────────

describe("Base audit prompt — false-positive guardrails", () => {
  it("contains the EVIDENCE & FALSE-POSITIVE GUARDRAILS section", () => {
    expect(BASE_AUDIT_PROMPT).toMatch(/EVIDENCE & FALSE-POSITIVE GUARDRAILS/);
  });

  it("forbids claiming an imported module does not exist from a diff", () => {
    expect(BASE_AUDIT_PROMPT).toMatch(/NEVER raise a finding claiming that an imported module/);
    expect(BASE_AUDIT_PROMPT).toMatch(/does not exist/);
    expect(BASE_AUDIT_PROMPT).toMatch(/cause a build failure/);
  });

  it("declares path aliases valid and resolved via tsconfig/bundler config", () => {
    expect(BASE_AUDIT_PROMPT).toMatch(/Path aliases are valid/);
    expect(BASE_AUDIT_PROMPT).toMatch(/@\//);
    expect(BASE_AUDIT_PROMPT).toMatch(/tsconfig\/jsconfig/);
  });

  it("treats the alias prefix as arbitrary/user-defined, not a fixed set", () => {
    expect(BASE_AUDIT_PROMPT).toMatch(/prefix is arbitrary and user-defined/);
    expect(BASE_AUDIT_PROMPT).toMatch(/do NOT assume a fixed set/);
    // Includes a non-"@" example so the guidance is not @-specific
    expect(BASE_AUDIT_PROMPT).toMatch(/~\//);
  });

  it("requires diff-sourced evidence before flagging an import", () => {
    expect(BASE_AUDIT_PROMPT).toMatch(/the diff ITSELF supplies the evidence/);
  });

  it("forbids unverified dependency-version 'removed/no longer exists' claims", () => {
    expect(BASE_AUDIT_PROMPT).toMatch(/was removed.*no longer exists/);
    expect(BASE_AUDIT_PROMPT).toMatch(/DEPENDENCY VERSION CONTEXT/);
    expect(BASE_AUDIT_PROMPT).toMatch(/training data lags real releases/);
  });
});

// ── Prompt version tests ──────────────────────────────────────────────────

describe("Prompt version", () => {
  it("is updated to current date format", () => {
    // Must be YYYY-MM-DD format
    expect(DEFAULT_PROMPT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("is not the old version 2026-02-16", () => {
    // The hardening update changed the version
    expect(DEFAULT_PROMPT_VERSION).not.toBe("2026-02-16");
  });
});

// ── Dependency context tests ──────────────────────────────────────────────

describe("Dependency context builder", () => {
  it("returns summary for this project (has package.json)", () => {
    const ctx = buildDependencyContext();
    expect(ctx.summary).toBeTruthy();
    expect(ctx.summary).toContain("mp-sentinel");
  });

  it("includes lockfile detection", () => {
    const ctx = buildDependencyContext();
    expect(typeof ctx.lockfileDetected).toBe("boolean");
  });

  it("includes dep count", () => {
    const ctx = buildDependencyContext();
    expect(ctx.depCount).toBeGreaterThanOrEqual(1);
  });

  it("handles non-existent directory gracefully", () => {
    const ctx = buildDependencyContext("/tmp/nonexistent-dir-12345");
    expect(ctx.summary).toBe("");
    expect(ctx.depCount).toBe(0);
    expect(ctx.lockfileDetected).toBe(false);
  });
});

// ── Parser metadata tests: parseAuditResponse ─────────────────────────

describe("AuditIssue metadata — via parseAuditResponse", () => {
  it("preserves category, confidence, evidence when present", () => {
    const raw = JSON.stringify({
      status: "FAIL",
      issues: [
        {
          line: 10,
          severity: "CRITICAL",
          message: "test",
          category: "security",
          confidence: "high",
          evidence: "pattern: eval, match: eval(code)",
        },
      ],
    });
    const result = parseAuditResponse(raw);
    const issue = result.issues![0]!;
    expect(issue.category).toBe("security");
    expect(issue.confidence).toBe("high");
    expect(issue.evidence).toMatch(/eval/);
  });

  it("parses without optional fields (backward compat)", () => {
    const raw = JSON.stringify({
      status: "PASS",
      issues: [{ line: 1, severity: "INFO", message: "old style" }],
    });
    const result = parseAuditResponse(raw);
    const issue = result.issues![0]!;
    expect(issue.category).toBeUndefined();
    expect(issue.confidence).toBeUndefined();
    expect(issue.evidence).toBeUndefined();
  });

  it("allows all valid category values through parseAuditResponse", () => {
    const categories = [
      "security",
      "runtime-crash",
      "architecture",
      "dependency-version",
      "test-gap",
      "performance",
      "maintainability",
    ];
    for (const cat of categories) {
      const raw = JSON.stringify({
        status: "FAIL",
        issues: [{ line: 1, severity: "WARNING", message: "test", category: cat }],
      });
      const result = parseAuditResponse(raw);
      expect(result.issues![0]!.category).toBe(cat);
    }
  });

  it("omits invalid category values (e.g. typo variants)", () => {
    const badCategories = [
      "runtime_crash",
      "security-critical",
      "Runtime-Crash",
      "SECURITY",
      "runtime crash",
      "unknown",
      "",
    ];
    for (const cat of badCategories) {
      const raw = JSON.stringify({
        status: "FAIL",
        issues: [{ line: 1, severity: "WARNING", message: "test", category: cat }],
      });
      const result = parseAuditResponse(raw);
      expect(result.issues![0]!.category).toBeUndefined();
    }
  });
});
