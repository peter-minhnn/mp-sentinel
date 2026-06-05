/**
 * Skill-adapter completeness contract: every skill-capable adapter
 * (claude, codex, antigravity, zed, windsurf, roo, cline) ships the same
 * progressive-disclosure layout — lean SKILL.md + full 10-file reference
 * set — and passes the shared quality gate, including the name/folder
 * match and reference-link checks. Also covers the new legacy advisories
 * for the old Windsurf/Roo/Cline rule paths.
 */

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach, beforeEach } from "@jest/globals";

import { getAdapter } from "../services/skills-generator/registry.js";
import { validateSkillQuality } from "../services/skills-generator/quality-gate.js";
import { buildSkillKnowledgeBase } from "../services/skills-generator/knowledge-base.js";
import { detectLegacyGeneratedFiles } from "../services/skills-generator/legacy-detection.js";
import { buildSourceIndex } from "../commands/indexing.js";
import { clearParserCache } from "../services/source-index/parser.js";
import { setLogQuietMode } from "../utils/logger.js";
import type { AgentAdapterId, SourceIndex } from "../types/index.js";

const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "mp-sentinel-skill-completeness-"));
  tempDirs.push(dir);
  return dir;
};

const makeMinimalProject = async (cwd: string): Promise<void> => {
  await mkdir(join(cwd, "src"), { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ name: "fixture", version: "1.0.0", dependencies: {} }),
  );
  await writeFile(join(cwd, "src", "index.ts"), `export function hello() { return "hi"; }`);
};

const buildFixtureIndex = async (cwd: string): Promise<SourceIndex> => {
  const index = await buildSourceIndex(
    cwd,
    {
      enabled: true,
      languages: ["typescript", "tsx", "javascript", "jsx"],
      cachePath: ".mp-sentinel-cache/source-index.json",
      maxFileSize: 512000,
    },
    true,
  );
  expect(index).not.toBeNull();
  return index!;
};

beforeEach(() => {
  clearParserCache();
  setLogQuietMode(true);
});

afterEach(async () => {
  clearParserCache();
  setLogQuietMode(false);
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const SKILL_ADAPTERS: Array<{ id: AgentAdapterId; folderSuffix: string }> = [
  { id: "claude", folderSuffix: "fixture-best-practices" },
  { id: "codex", folderSuffix: "fixture-codex-best-practices" },
  { id: "antigravity", folderSuffix: "fixture-antigravity-best-practices" },
  { id: "zed", folderSuffix: "fixture-zed-best-practices" },
  { id: "windsurf", folderSuffix: "fixture-windsurf-best-practices" },
  { id: "roo", folderSuffix: "fixture-roo-best-practices" },
  { id: "cline", folderSuffix: "fixture-cline-best-practices" },
];

const EXPECTED_REFERENCES = [
  "architecture.md",
  "modules.md",
  "commands.md",
  "codebase-map.md",
  "testing-map.md",
  "dependencies.md",
  "public-api.md",
  "code-style.md",
  "language-patterns.md",
  "clean-code-checklist.md",
];

describe("skill adapter completeness (progressive disclosure for all)", () => {
  it.each(SKILL_ADAPTERS)(
    "$id ships lean SKILL.md + full reference set and passes the quality gate",
    async ({ id, folderSuffix }) => {
      const cwd = await makeTempDir();
      await makeMinimalProject(cwd);
      const index = await buildFixtureIndex(cwd);
      const kb = buildSkillKnowledgeBase(index, cwd);

      const adapter = getAdapter(id)!;
      const files = await adapter.generate(index, {
        projectRoot: cwd,
        projectName: "fixture",
        force: false,
        knowledgeBase: kb,
      });

      // Exactly one SKILL.md, inside the expected folder
      const skillMds = files.filter((f) => f.outputPath.replace(/\\/g, "/").endsWith("/SKILL.md"));
      expect(skillMds).toHaveLength(1);
      const skillMd = skillMds[0]!;
      expect(skillMd.outputPath.replace(/\\/g, "/")).toContain(`/${folderSuffix}/`);

      // Frontmatter name matches the folder name
      expect(skillMd.content).toContain(`name: ${folderSuffix}`);

      // Full reference set generated
      for (const ref of EXPECTED_REFERENCES) {
        expect(
          files.some((f) => f.outputPath.replace(/\\/g, "/").endsWith(`references/${ref}`)),
        ).toBe(true);
      }

      // SKILL.md links all 10 references
      const linkCount = new Set(skillMd.content.match(/\(\.\/references\/[^)]+\.md\)/g)).size;
      expect(linkCount).toBe(10);

      // Lean SKILL.md: bulky maps live in references, not inline
      expect(skillMd.content).not.toContain("## Codebase Map");
      expect(skillMd.content).not.toContain("## Testing Map");
      expect(skillMd.content).not.toContain("## Public API Surface");

      // Shared quality gate passes (layout, sections, refs, name match, links)
      const report = validateSkillQuality(files, id, index, adapter.spec, "fixture");
      const errors = report.checks.filter((c) => c.severity === "error");
      expect(errors).toEqual([]);
    },
  );

  it("renders no empty rule-pack headings, but keeps packs with rules", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    const index = await buildFixtureIndex(cwd);
    const kb = buildSkillKnowledgeBase(index, cwd);

    const adapter = getAdapter("claude")!;
    const files = await adapter.generate(index, {
      projectRoot: cwd,
      projectName: "fixture",
      force: false,
      knowledgeBase: kb,
    });
    const skillMd = files.find((f) => f.outputPath.replace(/\\/g, "/").endsWith("/SKILL.md"))!;

    // Built-in Policies pack ships evaluators only -- its heading must not render
    expect(skillMd.content).not.toContain("### Built-in Policies Rules");
    // The TypeScript fixture activates the TS strict pack, which has rules
    expect(skillMd.content).toContain("### TypeScript (Strict) Rules");

    // Evaluator-only packs are also absent from the active rendered pack
    // list and the pack count, so the header matches the sections below
    const activeLine = skillMd.content.split("\n").find((l) => l.startsWith("Active packs:"));
    expect(activeLine).toBeDefined();
    expect(activeLine).not.toContain("Built-in Policies");
    expect(activeLine).toContain("TypeScript (Strict)");
    const summaryLine = skillMd.content.split("\n").find((l) => l.startsWith("Summary:"));
    expect(summaryLine).toContain("across 1 pack(s)");
  });

  it("flags a SKILL.md whose frontmatter name does not match its folder", () => {
    const files = [
      {
        outputPath: "/p/.claude/skills/demo-best-practices/SKILL.md",
        content: "---\nname: wrong-name\ndescription: d\n---\n\n# T\n",
      },
    ];
    const report = validateSkillQuality(files, "claude", null);
    expect(report.checks.some((c) => c.type === "skill-name-folder-match")).toBe(true);
  });

  it("flags broken ./references links in SKILL.md", () => {
    const files = [
      {
        outputPath: "/p/.claude/skills/demo-best-practices/SKILL.md",
        content:
          "---\nname: demo-best-practices\ndescription: d\n---\n\n" +
          "## References\n\n- [Missing](./references/missing.md)\n",
      },
    ];
    const report = validateSkillQuality(files, "claude", null);
    expect(report.checks.some((c) => c.type === "reference-link" && c.severity === "error")).toBe(
      true,
    );
  });
});

describe("legacy advisories for old Windsurf/Roo/Cline rule paths", () => {
  const legacyHeader = (agent: string): string =>
    `<!-- @mp-sentinel-generated generatorVersion=2.9.0 sourceIndexSchema=1.3 sourceIndexHash=abcdef1234567890 agent=${agent} projectName=demo -->`;

  it.each([
    { agent: "windsurf", path: ".windsurf/rules/demo-best-practices.md" },
    { agent: "roo", path: ".roo/rules/demo-best-practices.md" },
    { agent: "cline", path: ".clinerules/demo-best-practices.md" },
  ])("flags old $agent rule file as a legacy advisory", async ({ agent, path }) => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, path.split("/").slice(0, -1).join("/")), { recursive: true });
    await writeFile(join(cwd, path), `${legacyHeader(agent)}\n# Old generated rules\n`);

    const legacy = await detectLegacyGeneratedFiles(cwd, "demo");
    const entry = legacy.find((f) => f.path === path);
    expect(entry).toBeDefined();
    expect(entry?.agent).toBe(agent);
    expect(entry?.suggestion).toContain("skills");
  });

  it("never flags user-authored files at legacy paths (no metadata marker)", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, ".windsurf", "rules"), { recursive: true });
    await writeFile(join(cwd, ".windsurf", "rules", "demo-best-practices.md"), "# my own rules\n");

    const legacy = await detectLegacyGeneratedFiles(cwd, "demo");
    expect(legacy.find((f) => f.path.includes(".windsurf"))).toBeUndefined();
  });
});
