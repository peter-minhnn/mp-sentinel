/**
 * Unit tests for src/utils/parser.ts
 */

import { describe, it, expect } from "@jest/globals";
import { parseAuditResponse, cleanJSON } from "../utils/parser.js";

describe("cleanJSON", () => {
  it("strips markdown json fences", () => {
    const input = '```json\n{"status":"PASS"}\n```';
    expect(cleanJSON(input)).toBe('{"status":"PASS"}');
  });

  it("strips plain code fences", () => {
    const input = '```\n{"status":"PASS"}\n```';
    expect(cleanJSON(input)).toBe('{"status":"PASS"}');
  });

  it("returns plain JSON unchanged", () => {
    const input = '{"status":"PASS"}';
    expect(cleanJSON(input)).toBe('{"status":"PASS"}');
  });
});

describe("parseAuditResponse", () => {
  it("parses a valid PASS response", () => {
    const raw = JSON.stringify({ status: "PASS", issues: [] });
    const result = parseAuditResponse(raw);
    expect(result.status).toBe("PASS");
    expect(result.issues).toEqual([]);
  });

  it("parses a valid FAIL response with issues", () => {
    const raw = JSON.stringify({
      status: "FAIL",
      issues: [{ line: 10, severity: "CRITICAL", message: "Hardcoded secret" }],
    });
    const result = parseAuditResponse(raw);
    expect(result.status).toBe("FAIL");
    expect(result.issues).toHaveLength(1);
    expect(result.issues?.[0]?.severity).toBe("CRITICAL");
  });

  it("normalises missing issues array to []", () => {
    const raw = JSON.stringify({ status: "PASS" });
    const result = parseAuditResponse(raw);
    expect(result.issues).toEqual([]);
  });

  it("normalises invalid severity to WARNING", () => {
    const raw = JSON.stringify({
      status: "FAIL",
      issues: [{ line: 1, severity: "UNKNOWN", message: "test" }],
    });
    const result = parseAuditResponse(raw);
    expect(result.issues?.[0]?.severity).toBe("WARNING");
  });

  it("normalises invalid line number to 1", () => {
    const raw = JSON.stringify({
      status: "FAIL",
      issues: [{ line: -5, severity: "INFO", message: "test" }],
    });
    const result = parseAuditResponse(raw);
    expect(result.issues?.[0]?.line).toBe(1);
  });

  it("returns ERROR status for completely malformed JSON", () => {
    const result = parseAuditResponse("not json at all");
    expect(result.status).toBe("ERROR");
  });

  it("extracts JSON embedded in prose", () => {
    const raw = 'Here is the result: {"status":"PASS","issues":[]}';
    const result = parseAuditResponse(raw);
    expect(result.status).toBe("PASS");
  });

  it("returns ERROR for invalid status value", () => {
    const raw = JSON.stringify({ status: "INVALID" });
    const result = parseAuditResponse(raw);
    expect(result.status).toBe("ERROR");
  });

  it("strips markdown fences before parsing", () => {
    const raw = '```json\n{"status":"PASS","issues":[]}\n```';
    const result = parseAuditResponse(raw);
    expect(result.status).toBe("PASS");
  });
});
