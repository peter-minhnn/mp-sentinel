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

  // ── Status normalization ──

  it("normalises PASS + CRITICAL issue to FAIL", () => {
    const raw = JSON.stringify({
      status: "PASS",
      issues: [{ line: 1, severity: "CRITICAL", message: "XSS risk" }],
    });
    const result = parseAuditResponse(raw);
    expect(result.status).toBe("FAIL");
    expect(result.issues).toHaveLength(1);
  });

  it("normalises PASS + WARNING issue to FAIL", () => {
    const raw = JSON.stringify({
      status: "PASS",
      issues: [{ line: 1, severity: "WARNING", message: "unvalidated input" }],
    });
    const result = parseAuditResponse(raw);
    expect(result.status).toBe("FAIL");
  });

  it("keeps PASS when issues are INFO-only", () => {
    const raw = JSON.stringify({
      status: "PASS",
      issues: [
        { line: 1, severity: "INFO", message: "consider refactoring" },
        { line: 2, severity: "INFO", message: "add docs" },
      ],
    });
    const result = parseAuditResponse(raw);
    expect(result.status).toBe("PASS");
  });

  it("normalises PASS + invalid severity (normalised to WARNING) to FAIL", () => {
    const raw = JSON.stringify({
      status: "PASS",
      issues: [{ line: 1, severity: "UNKNOWN", message: "something" }],
    });
    const result = parseAuditResponse(raw);
    expect(result.status).toBe("FAIL");
    expect(result.issues?.[0]?.severity).toBe("WARNING");
  });

  // ── codeSuggestion preservation + sanitization ──

  it("preserves a valid codeSuggestion", () => {
    const raw = JSON.stringify({
      status: "FAIL",
      issues: [
        {
          line: 3,
          severity: "CRITICAL",
          message: "use parameterized query",
          codeSuggestion: "db.query('SELECT * FROM t WHERE id = $1', [id]);",
        },
      ],
    });
    const result = parseAuditResponse(raw);
    expect(result.issues?.[0]?.codeSuggestion).toBe(
      "db.query('SELECT * FROM t WHERE id = $1', [id]);",
    );
  });

  it("drops an oversized codeSuggestion", () => {
    const raw = JSON.stringify({
      status: "FAIL",
      issues: [{ line: 1, severity: "WARNING", message: "m", codeSuggestion: "x;\n".repeat(40) }],
    });
    const result = parseAuditResponse(raw);
    expect(result.issues?.[0]?.codeSuggestion).toBeUndefined();
  });

  it("drops a codeSuggestion that exceeds the length cap", () => {
    const raw = JSON.stringify({
      status: "FAIL",
      issues: [{ line: 1, severity: "WARNING", message: "m", codeSuggestion: "a".repeat(2000) }],
    });
    const result = parseAuditResponse(raw);
    expect(result.issues?.[0]?.codeSuggestion).toBeUndefined();
  });

  it("drops an empty codeSuggestion", () => {
    const raw = JSON.stringify({
      status: "FAIL",
      issues: [{ line: 1, severity: "WARNING", message: "m", codeSuggestion: "   " }],
    });
    const result = parseAuditResponse(raw);
    expect(result.issues?.[0]?.codeSuggestion).toBeUndefined();
  });

  // ── Tolerant recovery (truncated / malformed responses) ──

  it("repairs trailing commas", () => {
    const raw = '{"status":"FAIL","issues":[{"line":1,"severity":"WARNING","message":"m"},]}';
    const result = parseAuditResponse(raw);
    expect(result.status).toBe("FAIL");
    expect(result.issues).toHaveLength(1);
  });

  it("extracts a JSON object surrounded by prose on both sides", () => {
    const raw = 'Sure, here you go:\n{"status":"PASS","issues":[]}\nLet me know if you need more.';
    const result = parseAuditResponse(raw);
    expect(result.status).toBe("PASS");
  });

  it("salvages complete issues from a truncated response", () => {
    // Response cut off mid-way through the third issue object.
    const raw =
      '{"status":"FAIL","issues":[' +
      '{"line":10,"severity":"CRITICAL","message":"XSS risk","category":"security"},' +
      '{"line":20,"severity":"WARNING","message":"missing null check"},' +
      '{"line":30,"severity":"WARNING","mess';
    const result = parseAuditResponse(raw);
    expect(result.status).toBe("FAIL"); // CRITICAL present
    expect(result.issues).toHaveLength(2); // the two complete objects
    expect(result.issues?.[0]?.severity).toBe("CRITICAL");
    expect(result.issues?.[1]?.message).toBe("missing null check");
  });

  it("salvages issues even when the leading status is truncated away", () => {
    const raw =
      '{"issues":[{"line":1,"severity":"WARNING","message":"unvalidated input"},{"line":2,"sev';
    const result = parseAuditResponse(raw);
    expect(result.issues).toHaveLength(1);
    expect(result.status).toBe("FAIL"); // WARNING upgrades PASS→FAIL
  });

  it("returns ERROR when truncated before any complete issue", () => {
    const raw = '{"status":"FAIL","issues":[{"line":1,"severity":"CRIT';
    const result = parseAuditResponse(raw);
    expect(result.status).toBe("ERROR");
  });

  it("still returns ERROR for non-JSON prose", () => {
    expect(parseAuditResponse("I cannot review this code.").status).toBe("ERROR");
  });
});
