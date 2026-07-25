/**
 * Tests for the review provenance collector. Field source: review-0706.md —
 * the report lacked reproduce metadata (no command, compare branch, threshold,
 * provider/model, cache, or git HEAD), so branch drift was undetectable.
 */

import { describe, it, expect } from "@jest/globals";
import { collectProvenance } from "../utils/provenance.js";

describe("collectProvenance", () => {
  it("records the reproduce fields it is given plus the git HEAD SHA", async () => {
    const p = await collectProvenance({
      argv: ["review", "--compare-branch", "origin/develop", "--ai"],
      compareBranch: "origin/develop",
      threshold: "WARNING",
      provider: "anthropic",
      model: "claude-x",
      cacheBypassed: true,
      includeUncommitted: false,
      headShaImpl: async () => "a".repeat(40),
    });
    expect(p.command).toBe("review --compare-branch origin/develop --ai");
    expect(p.compareBranch).toBe("origin/develop");
    expect(p.threshold).toBe("WARNING");
    expect(p.provider).toBe("anthropic");
    expect(p.model).toBe("claude-x");
    expect(p.cache).toBe("bypassed");
    expect(p.includeUncommitted).toBe(false);
    expect(p.gitHeadSha).toBe("a".repeat(40));
  });

  it("maps a non-bypassed cache to 'enabled'", async () => {
    const p = await collectProvenance({ cacheBypassed: false, headShaImpl: async () => null });
    expect(p.cache).toBe("enabled");
  });

  it("omits the git HEAD field and fails open when the resolver throws", async () => {
    const p = await collectProvenance({
      argv: ["review"],
      headShaImpl: async () => {
        throw new Error("not a git repo");
      },
    });
    expect(p.gitHeadSha).toBeUndefined();
    expect(p.command).toBe("review");
  });

  it("leaves optional fields unset when not provided", async () => {
    const p = await collectProvenance({ argv: ["review"], headShaImpl: async () => null });
    expect(p.compareBranch).toBeUndefined();
    expect(p.provider).toBeUndefined();
    expect(p.cache).toBeUndefined();
    expect(p.includeUncommitted).toBeUndefined();
  });
});
