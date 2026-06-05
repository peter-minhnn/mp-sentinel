/**
 * Unit tests for the conservative dependency-version gate
 * (rule-packs/version-gate.ts): range parsing and requirement checks.
 */

import { describe, it, expect } from "@jest/globals";
import {
  resolveSafeMajor,
  requirementSatisfied,
  requirementsSatisfied,
} from "../services/skills-generator/rule-packs/version-gate.js";

describe("resolveSafeMajor", () => {
  it("resolves exact versions", () => {
    expect(resolveSafeMajor("4.2.1")).toBe(4);
    expect(resolveSafeMajor("v5.0.0")).toBe(5);
    expect(resolveSafeMajor("5")).toBe(5);
    expect(resolveSafeMajor("5.0")).toBe(5);
    expect(resolveSafeMajor("1.2.3-beta.1")).toBe(1);
    expect(resolveSafeMajor("0.34.2")).toBe(0);
  });

  it("resolves caret, tilde, and equals ranges", () => {
    expect(resolveSafeMajor("^5.1.0")).toBe(5);
    expect(resolveSafeMajor("~4.2.0")).toBe(4);
    expect(resolveSafeMajor("=3.0.0")).toBe(3);
    expect(resolveSafeMajor("^0.5.0")).toBe(0);
  });

  it("resolves X-ranges with a concrete major", () => {
    expect(resolveSafeMajor("5.x")).toBe(5);
    expect(resolveSafeMajor("16.*")).toBe(16);
  });

  it("resolves compound inequalities that pin a single major", () => {
    expect(resolveSafeMajor(">=4 <5")).toBe(4);
    expect(resolveSafeMajor(">=16.0.0 <17.0.0")).toBe(16);
    expect(resolveSafeMajor(">=13.0.0 <=13.9.9")).toBe(13);
  });

  it("returns null for one-sided or multi-major inequalities", () => {
    expect(resolveSafeMajor(">=4")).toBeNull();
    expect(resolveSafeMajor(">4.0.0")).toBeNull();
    expect(resolveSafeMajor("<5")).toBeNull();
    expect(resolveSafeMajor(">=4 <6")).toBeNull();
  });

  it("resolves hyphen ranges only within one major", () => {
    expect(resolveSafeMajor("4.0.0 - 4.9.9")).toBe(4);
    expect(resolveSafeMajor("4.0.0 - 5.0.0")).toBeNull();
  });

  it("handles union ranges conservatively", () => {
    expect(resolveSafeMajor("^5.0.0 || 5.2.x")).toBe(5);
    expect(resolveSafeMajor("^4.0.0 || ^5.0.0")).toBeNull();
    expect(resolveSafeMajor("^5.0.0 || latest")).toBeNull();
  });

  it("resolves npm aliases with embedded ranges", () => {
    expect(resolveSafeMajor("npm:svelte@^5.0.0")).toBe(5);
    expect(resolveSafeMajor("npm:@scope/pkg@~4.1.0")).toBe(4);
    expect(resolveSafeMajor("npm:foo")).toBeNull();
    expect(resolveSafeMajor("npm:@scope/pkg")).toBeNull();
  });

  it("resolves workspace protocol only with explicit versions", () => {
    expect(resolveSafeMajor("workspace:^5.0.0")).toBe(5);
    expect(resolveSafeMajor("workspace:*")).toBeNull();
    expect(resolveSafeMajor("workspace:^")).toBeNull();
  });

  it("never resolves file/link/git/url/tag/unknown ranges", () => {
    expect(resolveSafeMajor("file:../local-pkg")).toBeNull();
    expect(resolveSafeMajor("link:../local-pkg")).toBeNull();
    expect(resolveSafeMajor("git+https://github.com/u/r.git")).toBeNull();
    expect(resolveSafeMajor("github:user/repo")).toBeNull();
    expect(resolveSafeMajor("https://example.com/pkg.tgz")).toBeNull();
    expect(resolveSafeMajor("latest")).toBeNull();
    expect(resolveSafeMajor("next")).toBeNull();
    expect(resolveSafeMajor("*")).toBeNull();
    expect(resolveSafeMajor("x")).toBeNull();
    expect(resolveSafeMajor("")).toBeNull();
    expect(resolveSafeMajor(undefined)).toBeNull();
    expect(resolveSafeMajor("not-a-version")).toBeNull();
  });
});

describe("requirementSatisfied / requirementsSatisfied", () => {
  const deps = { svelte: "^5.0.0", vue: "~2.7.0", next: "latest" };

  it("satisfies min/max major bounds with identifiable majors", () => {
    expect(requirementSatisfied({ dep: "svelte", minMajor: 5 }, deps)).toBe(true);
    expect(requirementSatisfied({ dep: "svelte", minMajor: 6 }, deps)).toBe(false);
    expect(requirementSatisfied({ dep: "vue", maxMajor: 2 }, deps)).toBe(true);
    expect(requirementSatisfied({ dep: "vue", minMajor: 3 }, deps)).toBe(false);
  });

  it("never satisfies requirements for unknown or missing deps (conservative)", () => {
    expect(requirementSatisfied({ dep: "next", minMajor: 13 }, deps)).toBe(false);
    expect(requirementSatisfied({ dep: "absent", minMajor: 1 }, deps)).toBe(false);
  });

  it("requirementsSatisfied: empty requires always passes, all must hold", () => {
    expect(requirementsSatisfied(undefined, deps)).toBe(true);
    expect(requirementsSatisfied([], deps)).toBe(true);
    expect(
      requirementsSatisfied(
        [
          { dep: "svelte", minMajor: 5 },
          { dep: "vue", maxMajor: 2 },
        ],
        deps,
      ),
    ).toBe(true);
    expect(
      requirementsSatisfied(
        [
          { dep: "svelte", minMajor: 5 },
          { dep: "next", minMajor: 13 },
        ],
        deps,
      ),
    ).toBe(false);
  });
});
