import { strict as assert } from "node:assert";
import { test } from "node:test";

import { resolveWorkspaceFiles, workspaceRelativePath } from "../src/pure/paths.js";

test("single-root: returns a forward-slash path relative to the folder", () => {
  assert.equal(workspaceRelativePath("/repo", "/repo/src/a.ts"), "src/a.ts");
});

test("nested files keep their full relative path", () => {
  assert.equal(workspaceRelativePath("/repo", "/repo/src/x/y/z.ts"), "src/x/y/z.ts");
});

test("a trailing slash on the root is tolerated", () => {
  assert.equal(workspaceRelativePath("/repo/", "/repo/a.ts"), "a.ts");
});

test("the folder itself has no relative file path", () => {
  assert.equal(workspaceRelativePath("/repo", "/repo"), null);
});

test("a file outside the folder is rejected", () => {
  assert.equal(workspaceRelativePath("/repo", "/other/a.ts"), null);
});

test("multi-root: a file resolves only against its own folder", () => {
  assert.equal(workspaceRelativePath("/repoA", "/repoB/a.ts"), null);
  assert.equal(workspaceRelativePath("/repoB", "/repoB/a.ts"), "a.ts");
});

test("Windows separators are normalized to forward slashes", () => {
  assert.equal(workspaceRelativePath("C:\\repo", "C:\\repo\\src\\a.ts"), "src/a.ts");
});

test("a sibling folder sharing a name prefix is not treated as inside", () => {
  assert.equal(workspaceRelativePath("/repo", "/repo-other/a.ts"), null);
});

test("resolveWorkspaceFiles maps every in-folder file", () => {
  const result = resolveWorkspaceFiles("/repo", ["/repo/a.ts", "/repo/src/b.ts"]);
  assert.deepEqual(result, { ok: true, files: ["a.ts", "src/b.ts"] });
});

test("resolveWorkspaceFiles rejects a selection spanning folders", () => {
  const result = resolveWorkspaceFiles("/repo", ["/repo/a.ts", "/other/c.ts"]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.outside, ["/other/c.ts"]);
});
