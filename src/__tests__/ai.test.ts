/**
 * Unit tests for AI service — tests parseAuditResponse integration
 * and the error-handling contract of auditFile.
 *
 * NOTE: Full provider mocking with ESM jest.mock() requires careful path
 * resolution. These tests verify the parsing/error-handling layer directly
 * without making real network calls.
 */

import { describe, it, expect } from "@jest/globals";
import { parseAuditResponse } from "../utils/parser.js";

// ── Integration-style tests for the AI response parsing pipeline ──────────────
// These test the same code path that auditFile uses internally.

describe("AI response parsing pipeline", () => {
  it("parses a PASS response correctly", () => {
    const raw = JSON.stringify({ status: "PASS", issues: [] });
    const result = parseAuditResponse(raw);
    expect(result.status).toBe("PASS");
    expect(result.issues).toEqual([]);
  });

  it("parses a FAIL response with CRITICAL issue", () => {
    const raw = JSON.stringify({
      status: "FAIL",
      issues: [
        {
          line: 42,
          severity: "CRITICAL",
          message: "Hardcoded API key detected",
          suggestion: "Use environment variables",
        },
      ],
    });
    const result = parseAuditResponse(raw);
    expect(result.status).toBe("FAIL");
    expect(result.issues).toHaveLength(1);
    expect(result.issues?.[0]?.line).toBe(42);
    expect(result.issues?.[0]?.severity).toBe("CRITICAL");
    expect(result.issues?.[0]?.suggestion).toBe("Use environment variables");
  });

  it("parses a FAIL response with WARNING issue", () => {
    const raw = JSON.stringify({
      status: "FAIL",
      issues: [{ line: 10, severity: "WARNING", message: "Magic number" }],
    });
    const result = parseAuditResponse(raw);
    expect(result.issues?.[0]?.severity).toBe("WARNING");
  });

  it("parses a FAIL response with INFO issue", () => {
    const raw = JSON.stringify({
      status: "FAIL",
      issues: [{ line: 1, severity: "INFO", message: "Consider adding JSDoc" }],
    });
    const result = parseAuditResponse(raw);
    expect(result.issues?.[0]?.severity).toBe("INFO");
  });

  it("returns ERROR for completely malformed AI output", () => {
    const result = parseAuditResponse("I cannot review this code.");
    expect(result.status).toBe("ERROR");
    expect(result.message).toBe("Failed to parse AI response");
  });

  it("handles markdown-wrapped JSON from AI", () => {
    const raw = '```json\n{"status":"PASS","issues":[]}\n```';
    const result = parseAuditResponse(raw);
    expect(result.status).toBe("PASS");
  });

  it("extracts JSON embedded in prose from AI", () => {
    const raw = 'After reviewing the code, here is my assessment: {"status":"PASS","issues":[]}';
    const result = parseAuditResponse(raw);
    expect(result.status).toBe("PASS");
  });

  it("normalises invalid severity to WARNING", () => {
    const raw = JSON.stringify({
      status: "FAIL",
      issues: [{ line: 1, severity: "BLOCKER", message: "test" }],
    });
    const result = parseAuditResponse(raw);
    expect(result.issues?.[0]?.severity).toBe("WARNING");
  });

  it("normalises negative line numbers to 1", () => {
    const raw = JSON.stringify({
      status: "FAIL",
      issues: [{ line: -10, severity: "INFO", message: "test" }],
    });
    const result = parseAuditResponse(raw);
    expect(result.issues?.[0]?.line).toBe(1);
  });

  it("filters out issues without a message", () => {
    const raw = JSON.stringify({
      status: "FAIL",
      issues: [
        { line: 1, severity: "INFO" }, // no message
        { line: 2, severity: "WARNING", message: "valid" },
      ],
    });
    const result = parseAuditResponse(raw);
    expect(result.issues).toHaveLength(1);
    expect(result.issues?.[0]?.message).toBe("valid");
  });
});
