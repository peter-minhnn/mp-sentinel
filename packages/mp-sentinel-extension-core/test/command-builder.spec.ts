import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  buildCreateSkillsArgs,
  buildDryRunArgs,
  buildExplainContextArgs,
  buildIndexingArgs,
  buildInitArgs,
  buildReviewArgs,
} from "../src/command-builder.js";

test("review: staged defaults to json and force-ai when requested", () => {
  assert.deepEqual(buildReviewArgs({ scope: { kind: "staged" }, forceAi: true }), [
    "--staged",
    "--ai",
    "--format",
    "json",
  ]);
});

test("review: files scope expands variadic file list", () => {
  assert.deepEqual(
    buildReviewArgs({ scope: { kind: "files", files: ["a.ts", "b.ts"] } }),
    ["--files", "a.ts", "b.ts", "--format", "json"],
  );
});

test("review: range with target branch and no-cache", () => {
  assert.deepEqual(
    buildReviewArgs({
      scope: { kind: "range", range: "main..HEAD" },
      targetBranch: "origin/main",
      noCache: true,
    }),
    ["--range", "main..HEAD", "--target-branch", "origin/main", "--no-cache", "--format", "json"],
  );
});

test("review: local mode with commit count and branch diff", () => {
  assert.deepEqual(
    buildReviewArgs({ scope: { kind: "local", commits: 5, branchDiff: true } }),
    ["--local", "--commits", "5", "--branch-diff", "--format", "json"],
  );
});

test("explain-context targets files in json", () => {
  assert.deepEqual(buildExplainContextArgs(["src/x.ts"]), [
    "--explain-context",
    "--format",
    "json",
    "--files",
    "src/x.ts",
  ]);
});

test("dry-run prepends --dry-run", () => {
  const args = buildDryRunArgs({ kind: "staged" });
  assert.equal(args[0], "--dry-run");
  assert.ok(args.includes("--staged"));
});

test("indexing query modes request json; rebuild does not", () => {
  assert.deepEqual(buildIndexingArgs({ kind: "health" }), [
    "indexing",
    "--health",
    "--index-format",
    "json",
  ]);
  assert.deepEqual(buildIndexingArgs({ kind: "rebuild" }), ["indexing"]);
  assert.deepEqual(buildIndexingArgs({ kind: "rebuild", force: true }), ["indexing", "--force"]);
  assert.deepEqual(buildIndexingArgs({ kind: "explain-index", file: "src/a.ts" }), [
    "indexing",
    "--explain-index",
    "src/a.ts",
    "--index-format",
    "json",
  ]);
});

test("create-skills: check with all-agents in json", () => {
  assert.deepEqual(buildCreateSkillsArgs({ operation: { kind: "check" }, agents: "all", json: true }), [
    "create-skills",
    "--check",
    "--all-agents",
    "--format",
    "json",
  ]);
});

test("create-skills: generate with explicit agents and force", () => {
  assert.deepEqual(
    buildCreateSkillsArgs({
      operation: { kind: "generate", force: true },
      agents: ["claude", "cursor"],
    }),
    ["create-skills", "--force", "--agent", "claude,cursor"],
  );
});

test("create-skills: explain-agents allows json without agents", () => {
  assert.deepEqual(buildCreateSkillsArgs({ operation: { kind: "explain-agents" }, json: true }), [
    "create-skills",
    "--explain-agents",
    "--format",
    "json",
  ]);
});

test("init builds with force and json", () => {
  assert.deepEqual(buildInitArgs({ force: true, json: true }), ["init", "--force", "--format", "json"]);
});
