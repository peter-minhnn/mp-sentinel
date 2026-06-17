import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  CliJsonParseError,
  extractJson,
  parseCheckAi,
  parseCreateSkillsCheck,
  parseIndexHealth,
  parseReviewReport,
} from "../src/parse.js";

test("parseCheckAi accepts ok and error results, rejects non-JSON", () => {
  assert.equal(parseCheckAi('{"status":"ok","provider":"anthropic"}').status, "ok");
  assert.equal(parseCheckAi('{"status":"error","error":"403"}').status, "error");
  assert.throws(() => parseCheckAi("not json"), CliJsonParseError);
});

test("extractJson parses pure JSON", () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
});

test("extractJson skips a leading banner line", () => {
  const out = 'Some stderr leaked to stdout\n{"status":"ok"}\n';
  assert.deepEqual(extractJson(out), { status: "ok" });
});

test("extractJson handles braces inside strings", () => {
  const out = 'noise {"msg":"a } b","n":2} trailing';
  assert.deepEqual(extractJson(out), { msg: "a } b", n: 2 });
});

test("extractJson throws on empty/garbage", () => {
  assert.throws(() => extractJson("   "), CliJsonParseError);
  assert.throws(() => extractJson("no json here"), CliJsonParseError);
});

test("parseReviewReport validates shape", () => {
  const report = parseReviewReport(
    JSON.stringify({ status: "FAIL", results: [], summary: {}, errors: [], skipped: [] }),
  );
  assert.equal(report.status, "FAIL");
  assert.throws(() => parseReviewReport('{"status":"FAIL"}'), CliJsonParseError);
});

test("parseIndexHealth accepts missing/stale states", () => {
  assert.equal(parseIndexHealth('{"status":"missing"}').status, "missing");
  assert.equal(
    parseIndexHealth('{"status":"stale","staleReasons":["manifest changed"]}').status,
    "stale",
  );
});

test("parseCreateSkillsCheck requires a check array", () => {
  assert.equal(parseCreateSkillsCheck('{"check":[],"status":"ok"}').status, "ok");
  assert.throws(() => parseCreateSkillsCheck('{"status":"ok"}'), CliJsonParseError);
});
