/**
 * Instruction-file discovery tests: generated skills must recommend the
 * official skill paths and must NOT recommend legacy generated rule
 * locations — while user-authored files at legacy paths stay discoverable.
 */

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach, beforeEach } from "@jest/globals";

import { detectInstructionFiles } from "../services/skills-generator/instruction-files.js";
import { buildSkillKnowledgeBase } from "../services/skills-generator/knowledge-base.js";
import { generateContent } from "../services/skills-generator/content.js";
import { buildSourceIndex } from "../commands/indexing.js";
import { clearParserCache } from "../services/source-index/parser.js";
import { setLogQuietMode } from "../utils/logger.js";

const GENERATED_HEADER =
  "<!-- @mp-sentinel-generated generatorVersion=2.9.0 sourceIndexSchema=1.3 " +
  "sourceIndexHash=abcdef1234567890 agent=windsurf projectName=demo -->";

const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "mp-sentinel-instruction-files-"));
  tempDirs.push(dir);
  return dir;
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

describe("detectInstructionFiles", () => {
  it("includes official skill paths when present", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, ".claude", "skills"), { recursive: true });
    await mkdir(join(cwd, ".windsurf", "skills"), { recursive: true });
    await mkdir(join(cwd, ".roo", "skills"), { recursive: true });
    await mkdir(join(cwd, ".cline", "skills"), { recursive: true });
    await writeFile(join(cwd, "AGENTS.md"), "# rules\n");

    const found = detectInstructionFiles(cwd);
    expect(found).toContain("AGENTS.md");
    expect(found).toContain(".claude/skills");
    expect(found).toContain(".windsurf/skills");
    expect(found).toContain(".roo/skills");
    expect(found).toContain(".cline/skills");
  });

  it("excludes legacy locations that hold only generated files", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, ".windsurf", "rules"), { recursive: true });
    await mkdir(join(cwd, ".roo", "rules"), { recursive: true });
    await mkdir(join(cwd, ".clinerules"), { recursive: true });
    const body = `${GENERATED_HEADER}\n# Old generated rules\n`;
    await writeFile(join(cwd, ".windsurf", "rules", "demo-best-practices.md"), body);
    await writeFile(join(cwd, ".roo", "rules", "demo-best-practices.md"), body);
    await writeFile(join(cwd, ".clinerules", "demo-best-practices.md"), body);

    const found = detectInstructionFiles(cwd);
    expect(found).not.toContain(".windsurf/rules");
    expect(found).not.toContain(".roo/rules");
    expect(found).not.toContain(".clinerules");
  });

  it("keeps legacy locations with user-authored content (no marker)", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, ".windsurf", "rules"), { recursive: true });
    await writeFile(join(cwd, ".windsurf", "rules", "my-team-rules.md"), "# my own rules\n");
    // Mixed dir: generated + user-authored still counts as user content
    await mkdir(join(cwd, ".roo", "rules"), { recursive: true });
    await writeFile(
      join(cwd, ".roo", "rules", "demo-best-practices.md"),
      `${GENERATED_HEADER}\n# Old generated rules\n`,
    );
    await writeFile(join(cwd, ".roo", "rules", "handwritten.md"), "# handwritten\n");

    const found = detectInstructionFiles(cwd);
    expect(found).toContain(".windsurf/rules");
    expect(found).toContain(".roo/rules");
  });

  it("keeps a legacy .clinerules FILE when user-authored, drops it when generated", async () => {
    const userCwd = await makeTempDir();
    await writeFile(join(userCwd, ".clinerules"), "# my cline rules\n");
    expect(detectInstructionFiles(userCwd)).toContain(".clinerules");

    const genCwd = await makeTempDir();
    await writeFile(join(genCwd, ".clinerules"), `${GENERATED_HEADER}\n# generated\n`);
    expect(detectInstructionFiles(genCwd)).not.toContain(".clinerules");
  });

  it("ignores empty legacy directories", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, ".windsurf", "rules"), { recursive: true });
    expect(detectInstructionFiles(cwd)).not.toContain(".windsurf/rules");
  });
});

describe("generated workflow recommends official paths, not legacy generated rules", () => {
  it("SKILL.md instruction step lists skill folders and omits superseded rule dirs", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0", dependencies: {} }),
    );
    await writeFile(join(cwd, "src", "index.ts"), `export function hello() { return "hi"; }`);

    // Official skill folders exist alongside generated-only legacy leftovers
    await mkdir(join(cwd, ".windsurf", "skills"), { recursive: true });
    await mkdir(join(cwd, ".cline", "skills"), { recursive: true });
    await mkdir(join(cwd, ".roo", "skills"), { recursive: true });
    await mkdir(join(cwd, ".windsurf", "rules"), { recursive: true });
    await writeFile(
      join(cwd, ".windsurf", "rules", "fixture-best-practices.md"),
      `${GENERATED_HEADER}\n# Old generated rules\n`,
    );

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
    const kb = buildSkillKnowledgeBase(index!, cwd);

    expect(kb.instructionFiles).toContain(".windsurf/skills");
    expect(kb.instructionFiles).toContain(".roo/skills");
    expect(kb.instructionFiles).toContain(".cline/skills");
    expect(kb.instructionFiles).not.toContain(".windsurf/rules");

    const content = generateContent(index, "fixture", null, kb);
    const instructionLine = content.sections.agentWorkflow
      .split("\n")
      .find((l) => l.includes("Read local agent instructions"));
    expect(instructionLine).toBeDefined();
    expect(instructionLine).toContain(".windsurf/skills");
    expect(instructionLine).toContain(".cline/skills");
    expect(instructionLine).not.toContain(".windsurf/rules");
  });

  it("fallback instruction text (no KB) mentions current official paths only", () => {
    const content = generateContent(null, "fixture");
    const line = content.sections.agentWorkflow
      .split("\n")
      .find((l) => l.includes("Read local agent instructions"));
    expect(line).toBeDefined();
    expect(line).toContain(".claude/skills/");
    expect(line).toContain(".windsurf/skills/");
    expect(line).toContain(".roo/skills/");
    expect(line).toContain(".cline/skills/");
    expect(line).not.toContain(".clinerules");
    expect(line).not.toContain(".windsurf/rules");
  });
});
