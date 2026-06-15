/**
 * Unit tests for git utility functions
 */

import { describe, it, expect } from "@jest/globals";
import {
  matchCommitPattern,
  shouldSkipCommit,
  getFilesFromCommits,
  resolveRenamedPathsPure,
} from "../utils/git.js";
import type { CommitInfo, CommitPattern } from "../types/index.js";

// -- matchCommitPattern --------------------------------------------------------

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

// -- shouldSkipCommit ----------------------------------------------------------

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

// -- getFilesFromCommits -------------------------------------------------------

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

// -- resolveRenamedPathsPure ---------------------------------------------------

describe("resolveRenamedPathsPure", () => {
  it("keeps existing paths untouched", () => {
    const exists = (p: string): boolean => ["src/a.ts", "src/b.ts"].includes(p);
    const res = resolveRenamedPathsPure(["src/a.ts", "src/b.ts"], new Map(), exists);
    expect(res.paths).toEqual(["src/a.ts", "src/b.ts"]);
    expect(res.renamed).toHaveLength(0);
    expect(res.dropped).toHaveLength(0);
  });

  it("remaps a renamed path to its current location", () => {
    const exists = (p: string): boolean => p === "src/modals/Book.tsx";
    const renameMap = new Map([["src/Book.tsx", "src/modals/Book.tsx"]]);
    const res = resolveRenamedPathsPure(["src/Book.tsx"], renameMap, exists);
    expect(res.paths).toEqual(["src/modals/Book.tsx"]);
    expect(res.renamed).toEqual([{ from: "src/Book.tsx", to: "src/modals/Book.tsx" }]);
    expect(res.dropped).toHaveLength(0);
  });

  it("follows a rename chain to the final name", () => {
    const exists = (p: string): boolean => p === "src/c.ts";
    const renameMap = new Map([
      ["src/a.ts", "src/b.ts"],
      ["src/b.ts", "src/c.ts"],
    ]);
    const res = resolveRenamedPathsPure(["src/a.ts"], renameMap, exists);
    expect(res.paths).toEqual(["src/c.ts"]);
    expect(res.renamed).toEqual([{ from: "src/a.ts", to: "src/c.ts" }]);
  });

  it("drops a deleted path with no rename target", () => {
    const exists = (): boolean => false;
    const res = resolveRenamedPathsPure(["src/gone.ts"], new Map(), exists);
    expect(res.paths).toEqual([]);
    expect(res.dropped).toEqual(["src/gone.ts"]);
  });

  it("de-duplicates when a rename target is already in the list", () => {
    const exists = (p: string): boolean => p === "src/modals/Book.tsx";
    const renameMap = new Map([["src/Book.tsx", "src/modals/Book.tsx"]]);
    // Both the old (deleted) and the new (added) path are present — diff-tree
    // lists both sides of a rename within one commit.
    const res = resolveRenamedPathsPure(["src/Book.tsx", "src/modals/Book.tsx"], renameMap, exists);
    expect(res.paths).toEqual(["src/modals/Book.tsx"]);
    expect(res.renamed).toEqual([{ from: "src/Book.tsx", to: "src/modals/Book.tsx" }]);
  });

  it("does not loop on a cyclic rename map", () => {
    const exists = (): boolean => false;
    const renameMap = new Map([
      ["src/a.ts", "src/b.ts"],
      ["src/b.ts", "src/a.ts"],
    ]);
    const res = resolveRenamedPathsPure(["src/a.ts"], renameMap, exists);
    expect(res.dropped).toEqual(["src/a.ts"]);
  });
});

// -- exclude-first mode --------------------------------------------------------

describe("matchCommitPattern \u2014 exclude-first mode", () => {
  const patterns: CommitPattern[] = [
    { type: "feat", pattern: "^feat" },
    { type: "fix", pattern: "^fix" },
  ];

  it("excludes commits matching excludePatterns before include matching", () => {
    const result = matchCommitPattern("feat: add login", patterns, {
      mode: "exclude-first",
      excludePatterns: ["^feat"],
    });
    expect(result.matched).toBe(false);
  });

  it("includes commits not matching excludePatterns", () => {
    const result = matchCommitPattern("fix: bug fix", patterns, {
      mode: "exclude-first",
      excludePatterns: ["^feat"],
    });
    expect(result.matched).toBe(true);
    expect(result.matchedPatterns[0]?.type).toBe("fix");
  });

  it("excludes merge commits with exclude-first", () => {
    const result = matchCommitPattern("Merge branch 'main'", patterns, {
      mode: "exclude-first",
      excludePatterns: ["^Merge"],
    });
    expect(result.matched).toBe(false);
  });

  it("returns false when no include patterns match after exclusion", () => {
    const result = matchCommitPattern("docs: update readme", patterns, {
      mode: "exclude-first",
      excludePatterns: [],
    });
    expect(result.matched).toBe(false);
  });

  it("handles empty excludePatterns (falls through to any logic)", () => {
    const result = matchCommitPattern("feat: add login", patterns, {
      mode: "exclude-first",
      excludePatterns: [],
    });
    expect(result.matched).toBe(true);
  });

  it("skips invalid exclude regex gracefully", () => {
    const result = matchCommitPattern("feat: add login", patterns, {
      mode: "exclude-first",
      excludePatterns: ["[invalid"],
    });
    // Invalid regex is skipped, so commit is not excluded
    expect(result.matched).toBe(true);
  });
});
