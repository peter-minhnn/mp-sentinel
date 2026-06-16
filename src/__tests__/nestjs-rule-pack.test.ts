/**
 * NestJS support: framework detection, rule-pack activation, version gating,
 * and controller-layering evaluators.
 */

import { describe, it, expect } from "@jest/globals";
import type { LanguageProfile } from "../types/index.js";
import {
  selectActiveRulePacks,
  type RulePackContext,
} from "../services/skills-generator/rule-packs/index.js";
import { evaluateChangedFiles } from "../services/skills-generator/rule-packs/evaluator.js";
import { detectFrameworks } from "../services/source-index/manifest.js";

const langProfile = (distribution: Record<string, number>): LanguageProfile => ({
  dominant: Object.keys(distribution)[0] ?? "typescript",
  secondary: [],
  distribution,
  indexableShare: 1,
  nonIndexableHotspots: [],
});

const ctx = (deps: Record<string, string>, frameworks: string[] = []): RulePackContext => ({
  langProfile: langProfile({ typescript: 10 }),
  frameworks,
  deps,
});

const ruleTexts = (c: RulePackContext): string[] =>
  selectActiveRulePacks(c).allRules.map((r) => r.text);

describe("detectFrameworks — NestJS", () => {
  it("detects NestJS from the scoped @nestjs/core package", () => {
    const fw = detectFrameworks("/tmp", { "@nestjs/core": "^9.0.0" }, {});
    expect(fw).toContain("nestjs");
  });

  it("detects NestJS from @nestjs/common when core is absent", () => {
    const fw = detectFrameworks("/tmp", { "@nestjs/common": "^10.0.0" }, {});
    expect(fw).toContain("nestjs");
  });

  it("does not report NestJS for a plain Express project", () => {
    const fw = detectFrameworks("/tmp", { express: "^4.18.0" }, {});
    expect(fw).not.toContain("nestjs");
    expect(fw).toContain("express");
  });
});

describe("NestJS rule pack activation", () => {
  it("activates when @nestjs/core is a dependency", () => {
    const { packs } = selectActiveRulePacks(ctx({ "@nestjs/core": "^9.0.0" }));
    expect(packs.find((p) => p.id === "nestjs")).toBeDefined();
  });

  it("activates from the detected frameworks list alone", () => {
    const { packs } = selectActiveRulePacks(ctx({}, ["nestjs"]));
    expect(packs.find((p) => p.id === "nestjs")).toBeDefined();
  });

  it("emits stable architecture rules regardless of version", () => {
    const texts = ruleTexts(ctx({ "@nestjs/core": "latest" }, ["nestjs"]));
    expect(texts.some((t) => t.includes("Keep controllers thin"))).toBe(true);
    expect(texts.some((t) => t.includes("DTO classes decorated by class-validator"))).toBe(true);
  });
});

describe("NestJS version gating", () => {
  it("on v9, surfaces the legacy-major note and NOT the Express 5 rule", () => {
    const texts = ruleTexts(ctx({ "@nestjs/core": "^9.0.0" }));
    expect(texts.some((t) => t.includes("project is on NestJS v9"))).toBe(true);
    expect(texts.some((t) => t.includes("wildcard route paths must be named"))).toBe(false);
  });

  it("on v11, surfaces the Express 5 rule and NOT the legacy note", () => {
    const texts = ruleTexts(ctx({ "@nestjs/core": "^11.0.0" }));
    expect(texts.some((t) => t.includes("wildcard route paths must be named"))).toBe(true);
    expect(texts.some((t) => t.includes("project is on NestJS v9"))).toBe(false);
  });

  it("on unknown ranges, surfaces neither version-specific rule but keeps stable ones", () => {
    const texts = ruleTexts(ctx({ "@nestjs/core": "*" }, ["nestjs"]));
    expect(texts.some((t) => t.includes("wildcard route paths must be named"))).toBe(false);
    expect(texts.some((t) => t.includes("project is on NestJS v9"))).toBe(false);
    expect(texts.some((t) => t.includes("Keep controllers thin"))).toBe(true);
  });
});

describe("NestJS evaluators", () => {
  const run = (filePath: string, content: string) =>
    evaluateChangedFiles(ctx({ "@nestjs/core": "^9.0.0" }), {
      files: new Map([[filePath, content]]),
    });

  it("flags direct repository access inside a controller", () => {
    const findings = run(
      "src/foo/foo.controller.ts",
      [
        "export class FooController {",
        "  async list() {",
        "    return this.repo.createQueryBuilder('f').getMany();",
        "  }",
        "}",
      ].join("\n"),
    );
    expect(findings.some((f) => f.ruleId === "nestjs/no-data-access-in-controller")).toBe(true);
  });

  it("flags an untyped @Body() payload", () => {
    const findings = run(
      "src/foo/foo.controller.ts",
      ["export class FooController {", "  create(@Body() dto: any) {}", "}"].join("\n"),
    );
    expect(findings.some((f) => f.ruleId === "nestjs/body-must-be-typed-dto")).toBe(true);
  });

  it("does not flag a clean controller delegating to a typed DTO + service", () => {
    const findings = run(
      "src/foo/foo.controller.ts",
      [
        "export class FooController {",
        "  constructor(private readonly service: FooService) {}",
        "  create(@Body() dto: CreateFooDto) {",
        "    return this.service.create(dto);",
        "  }",
        "}",
      ].join("\n"),
    );
    expect(findings.length).toBe(0);
  });

  it("does not run controller evaluators on non-controller files", () => {
    const findings = run(
      "src/foo/foo.service.ts",
      [
        "export class FooService {",
        "  q() { return this.repo.createQueryBuilder('f'); }",
        "}",
      ].join("\n"),
    );
    expect(findings.length).toBe(0);
  });
});
