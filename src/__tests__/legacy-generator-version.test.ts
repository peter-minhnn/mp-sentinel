/**
 * Tests for generator version upgrade detection
 */

import { describe, it, expect } from "@jest/globals";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GENERATOR_VERSION,
  parseGeneratorMajor,
  renderMetadataHeader,
} from "../services/skills-generator/metadata.js";
import { parseMetadataFromContent } from "../services/skills-generator/metadata.js";

// ── parseGeneratorMajor ─────────────────────────────────────────────────────

describe("parseGeneratorMajor", () => {
  it("parses 1.0.17 as major 1", () => {
    expect(parseGeneratorMajor("1.0.17")).toBe(1);
  });

  it("parses 2.0.0 as major 2", () => {
    expect(parseGeneratorMajor("2.0.0")).toBe(2);
  });

  it("parses 0.9.0 as major 0", () => {
    expect(parseGeneratorMajor("0.9.0")).toBe(0);
  });

  it("returns 0 for unparseable strings", () => {
    expect(parseGeneratorMajor("invalid")).toBe(0);
    expect(parseGeneratorMajor("")).toBe(0);
  });

  it("parses 3.0.0 as major 3", () => {
    expect(parseGeneratorMajor("3.0.0")).toBe(3);
  });

  it("current GENERATOR_VERSION is at least 3 (per-agent skill upgrade)", () => {
    expect(parseGeneratorMajor(GENERATOR_VERSION)).toBeGreaterThanOrEqual(3);
  });
});

// ── Generator version upgrade detection ─────────────────────────────────────

describe("Generator version upgrade detection", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("detects generatorVersion from rendered header", () => {
    const header = renderMetadataHeader({
      generatorVersion: "1.0.17",
      sourceIndexSchema: "1.2",
      sourceIndexHash: "abc123",
      agent: "claude",
      projectName: "test",
    });
    const content = header + "\n# Test\n";
    const meta = parseMetadataFromContent(content);
    expect(meta).not.toBeNull();
    expect(meta!.generatorVersion).toBe("1.0.17");

    // Should be detected as stale (major 1 < major 2)
    const isStale =
      parseGeneratorMajor(meta!.generatorVersion) < parseGeneratorMajor(GENERATOR_VERSION);
    expect(isStale).toBe(true);
  });

  it("v2.0.0 files are stale under the v3 generator even with a matching hash", () => {
    const header = renderMetadataHeader({
      generatorVersion: "2.0.0",
      sourceIndexSchema: "1.4",
      sourceIndexHash: "abc123",
      agent: "claude",
      projectName: "test",
    });
    const meta = parseMetadataFromContent(header + "\n# Test\n");
    expect(meta).not.toBeNull();
    const isStale =
      parseGeneratorMajor(meta!.generatorVersion) < parseGeneratorMajor(GENERATOR_VERSION);
    expect(isStale).toBe(true);
  });

  it("up-to-date generatorVersion does not trigger stale", () => {
    const header = renderMetadataHeader({
      generatorVersion: GENERATOR_VERSION,
      sourceIndexSchema: "1.2",
      sourceIndexHash: "abc123",
      agent: "claude",
      projectName: "test",
    });
    const content = header + "\n# Test\n";
    const meta = parseMetadataFromContent(content);
    expect(meta).not.toBeNull();
    expect(meta!.generatorVersion).toBe(GENERATOR_VERSION);

    const isStale =
      parseGeneratorMajor(meta!.generatorVersion) < parseGeneratorMajor(GENERATOR_VERSION);
    expect(isStale).toBe(false);
  });

  it("major version upgrade detection works in --check flow", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mp-sentinel-genver-"));
    await mkdir(join(tmpDir, "src"), { recursive: true });
    await writeFile(
      join(tmpDir, "package.json"),
      JSON.stringify({ name: "test", version: "1.0.0", dependencies: {} }),
    );
    await writeFile(join(tmpDir, "src", "index.ts"), "export const x = 1;\n");

    // Generate with current version
    const { clearParserCache } = await import("../services/source-index/parser.js");
    clearParserCache();
    const { runCreateSkillsCommand } = await import("../commands/create-skills.js");
    await runCreateSkillsCommand(
      {
        agent: "claude",
        "all-agents": false,
        "create-skills-force": true,
        "skip-index-refresh": false,
        "create-skills-no-ai-enrich": true,
      },
      tmpDir,
    );

    // Read the generated SKILL.md and verify version
    const { readFile } = await import("node:fs/promises");
    const skillPath = join(tmpDir, ".claude", "skills", "test-best-practices", "SKILL.md");
    const content = await readFile(skillPath, "utf-8");
    const meta = parseMetadataFromContent(content);
    expect(meta).not.toBeNull();
    expect(meta!.generatorVersion).toBe(GENERATOR_VERSION);

    // Downgrade the header to generatorVersion=2.0.0 (hash untouched) and
    // verify --check flags the file as stale purely on the version upgrade.
    const downgraded = content.replace(
      `generatorVersion=${GENERATOR_VERSION}`,
      "generatorVersion=2.0.0",
    );
    expect(downgraded).not.toBe(content);
    await writeFile(skillPath, downgraded);

    const checkExit = await runCreateSkillsCommand(
      {
        agent: "claude",
        "all-agents": false,
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-no-ai-enrich": true,
        "create-skills-check": true,
      },
      tmpDir,
    );
    expect(checkExit).toBe(1);
  });
});
