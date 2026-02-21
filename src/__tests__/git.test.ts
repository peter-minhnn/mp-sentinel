/**
 * Unit tests for git utility functions
 */

import { describe, it, expect } from "@jest/globals";
import { matchCommitPattern, shouldSkipCommit, getFilesFromCommits } from "../utils/git.js";
import type { CommitInfo, CommitPattern } from "../types/index.js";

// ── matchCommitPattern ────────────────────────────────────────────────────────

describe("matchCommitPattern", () => {
  const patterns: CommitPattern[] = [
    { type: "feat", pattern: "^feat" },
    { type: "fix", pattern: "^fix" },
    { type: "chore", pattern: "^chore", required: true },
  ];

  it("matches in 'any' mode when one pattern matches", () => {
    const result = matchCommitPattern("feat: add login", patterns, {
      mode: "any",
    });
    expect(result.matched).toBe(true);
    expect(result.matchedPatterns).toHaveLength(1);
    expect(result.matchedPatterns[0]?.type).toBe("feat");
  });

  it("does not match in 'any' mode when no pattern matches", () => {
    const result = matchCommitPattern("docs: update readme", patterns, {
      mode: "any",
    });
    expect(result.matched).toBe(false);
    expect(result.matchedPatterns).toHaveLength(0);
  });

  it("matches in 'all' mode when all required patterns match", () => {
    const result = matchCommitPattern("chore: release", patterns, {
      mode: "all",
    });
    expect(result.matched).toBe(true);
  });

  it("does not match in 'all' mode when required pattern is missing", () => {
    const result = matchCommitPattern("feat: add login", patterns, {
      mode: "all",
    });
    expect(result.matched).toBe(false);
    expect(result.unmatchedRequiredPatterns).toHaveLength(1);
    expect(result.unmatchedRequiredPatterns[0]?.type).toBe("chore");
  });

  it("is case-insensitive", () => {
    const result = matchCommitPattern("FEAT: add login", patterns, {
      mode: "any",
    });
    expect(result.matched).toBe(true);
  });

  it("skips invalid regex patterns gracefully", () => {
    const badPatterns: CommitPattern[] = [
      { type: "bad", pattern: "[invalid" },
      { type: "feat", pattern: "^feat" },
    ];
    const result = matchCommitPattern("feat: add login", badPatterns, {
      mode: "any",
    });
    expect(result.matched).toBe(true);
  });

  it("falls back to 'any' semantics in 'all' mode when no required patterns exist", () => {
    const noRequired: CommitPattern[] = [{ type: "feat", pattern: "^feat" }];
    const result = matchCommitPattern("feat: add login", noRequired, {
      mode: "all",
    });
    expect(result.matched).toBe(true);
  });
});

// ── shouldSkipCommit ──────────────────────────────────────────────────────────

describe("shouldSkipCommit", () => {
  it("returns true when message contains a skip pattern", () => {
    expect(shouldSkipCommit("skip: update deps", ["skip:"])).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(shouldSkipCommit("SKIP: update deps", ["skip:"])).toBe(true);
  });

  it("returns false when no skip pattern matches", () => {
    expect(shouldSkipCommit("feat: add login", ["skip:"])).toBe(false);
  });

  it("returns false for empty skip patterns", () => {
    expect(shouldSkipCommit("feat: add login", [])).toBe(false);
  });
});

// ── getFilesFromCommits ───────────────────────────────────────────────────────

describe("getFilesFromCommits", () => {
  it("returns unique files across multiple commits", () => {
    const commits: CommitInfo[] = [
      {
        hash: "abc",
        message: "feat: a",
        author: "dev",
        date: "2024-01-01",
        files: ["src/a.ts", "src/b.ts"],
      },
      {
        hash: "def",
        message: "fix: b",
        author: "dev",
        date: "2024-01-02",
        files: ["src/b.ts", "src/c.ts"],
      },
    ];
    const files = getFilesFromCommits(commits);
    expect(files).toHaveLength(3);
    expect(files).toContain("src/a.ts");
    expect(files).toContain("src/b.ts");
    expect(files).toContain("src/c.ts");
  });

  it("returns empty array for empty commits", () => {
    expect(getFilesFromCommits([])).toEqual([]);
  });
});
