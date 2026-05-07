/**
 * MCP template variable resolver tests.
 */

import { describe, it, expect } from "@jest/globals";
import { resolveTemplateVariables } from "../services/mcp/template-resolver.js";

const meta = {
  owner: "test-owner",
  name: "test-repo",
  fullName: "test-owner/test-repo",
  prNumber: 42,
  headSha: "abc123def",
  baseRef: "main",
  changedFilesCsv: "src/a.ts,src/b.ts,src/c.ts",
};

describe("resolveTemplateVariables", () => {
  it("resolves ${repo.owner}", () => {
    const result = resolveTemplateVariables({ query: "repo: ${repo.owner}" }, meta, "/workspace");
    expect(result).toEqual({ query: "repo: test-owner" });
  });

  it("resolves ${repo.name}", () => {
    const result = resolveTemplateVariables({ query: "${repo.name}" }, meta, "/workspace");
    expect(result).toEqual({ query: "test-repo" });
  });

  it("resolves ${repo.fullName}", () => {
    const result = resolveTemplateVariables({ query: "${repo.fullName}" }, meta, "/workspace");
    expect(result).toEqual({ query: "test-owner/test-repo" });
  });

  it("resolves ${pr.number}", () => {
    const result = resolveTemplateVariables({ pr: "${pr.number}" }, meta, "/workspace");
    expect(result).toEqual({ pr: "42" });
  });

  it("resolves ${head.sha}", () => {
    const result = resolveTemplateVariables({ sha: "${head.sha}" }, meta, "/workspace");
    expect(result).toEqual({ sha: "abc123def" });
  });

  it("resolves ${base.ref}", () => {
    const result = resolveTemplateVariables({ ref: "${base.ref}" }, meta, "/workspace");
    expect(result).toEqual({ ref: "main" });
  });

  it("resolves ${changedFiles.csv}", () => {
    const result = resolveTemplateVariables({ files: "${changedFiles.csv}" }, meta, "/workspace");
    expect(result).toEqual({ files: "src/a.ts,src/b.ts,src/c.ts" });
  });

  it("resolves ${cwd}", () => {
    const result = resolveTemplateVariables({ dir: "${cwd}" }, meta, "/workspace");
    expect(result).toEqual({ dir: "/workspace" });
  });

  it("resolves multiple template vars in single string", () => {
    const result = resolveTemplateVariables(
      { path: "${repo.fullName}#${pr.number}@${head.sha}" },
      meta,
      "/workspace",
    );
    expect(result).toEqual({ path: "test-owner/test-repo#42@abc123def" });
  });

  it("leaves unknown template var as-is", () => {
    const result = resolveTemplateVariables(
      { query: "status: ${unknown.thing}" },
      meta,
      "/workspace",
    );
    expect(result).toEqual({ query: "status: ${unknown.thing}" });
  });

  it("passes non-string values through unchanged", () => {
    const result = resolveTemplateVariables({ num: 42, bool: true, nil: null }, meta, "/workspace");
    expect(result).toEqual({ num: 42, bool: true, nil: null });
  });

  it("resolves template vars in nested objects", () => {
    const result = resolveTemplateVariables(
      {
        owner: { name: "${repo.owner}", repo: "${repo.name}" },
      },
      meta,
      "/workspace",
    );
    expect(result).toEqual({
      owner: { name: "test-owner", repo: "test-repo" },
    });
  });

  it("resolves template vars in arrays", () => {
    const result = resolveTemplateVariables(
      { paths: ["${repo.owner}", "${repo.name}"] },
      meta,
      "/workspace",
    );
    expect(result).toEqual({ paths: ["test-owner", "test-repo"] });
  });

  it("handles empty changedFiles.csv", () => {
    const emptyMeta = { ...meta, changedFilesCsv: "" };
    const result = resolveTemplateVariables(
      { files: "${changedFiles.csv}" },
      emptyMeta,
      "/workspace",
    );
    expect(result).toEqual({ files: "" });
  });

  it("handles zero PR number", () => {
    const zeroMeta = { ...meta, prNumber: 0 };
    const result = resolveTemplateVariables({ pr: "${pr.number}" }, zeroMeta, "/workspace");
    expect(result).toEqual({ pr: "0" });
  });

  it("resolves deeply nested objects with arrays", () => {
    const result = resolveTemplateVariables(
      {
        repos: [{ name: "${repo.name}", refs: ["${head.sha}", "${base.ref}"] }],
      },
      meta,
      "/workspace",
    );
    expect(result).toEqual({
      repos: [{ name: "test-repo", refs: ["abc123def", "main"] }],
    });
  });
});
