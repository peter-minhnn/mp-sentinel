/**
 * Tests for compliance harness dry-run mode.
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

const HARNESS_PATH = resolve(process.cwd(), "scripts", "compliance-harness.mjs");
const REPORT_PATH = resolve(process.cwd(), "docs", "COMPLIANCE_REPORT.md");

describe("compliance-harness.mjs", () => {
  it("dry-run exits 0", () => {
    // Need to run from repo root
    const result = execSync(`node "${HARNESS_PATH}"`, {
      encoding: "utf-8",
      timeout: 120000,
      cwd: process.cwd(),
      stdio: "pipe",
    });
    expect(result).toBeTruthy();
  }, 120000);

  it("produces a non-empty COMPLIANCE_REPORT.md", () => {
    expect(existsSync(REPORT_PATH)).toBe(true);
    const content = readFileSync(REPORT_PATH, "utf-8");
    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain("# Compliance Report");
    expect(content).toContain("svelte-imports");
    expect(content).toContain("dry-run");
  });

  it("report contains expected sections", () => {
    const content = readFileSync(REPORT_PATH, "utf-8");
    expect(content).toContain("## Summary");
    expect(content).toContain("## Methodology");
    expect(content).toContain("## Fixtures");
  });

  afterAll(() => {
    // Clean up report file after test
    try {
      if (existsSync(REPORT_PATH)) unlinkSync(REPORT_PATH);
    } catch {
      /* best effort */
    }
  });
});
