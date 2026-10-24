import { afterEach, describe, expect, it } from "@jest/globals";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { buildSourceIndex } from "../commands/indexing.js";
import { runCreateSkillsCommand } from "../commands/create-skills.js";
import { clearConfigCache } from "../utils/config.js";
import { detectProjectConventions } from "../services/skills-generator/convention-detectors.js";
import { renderProgressiveSkill } from "../services/skills-generator/adapters/skill-renderer.js";
import { computeGenerationConfigHash } from "../services/skills-generator/metadata.js";
import { extractTaskAnchors } from "../services/source-index/task-context.js";
import { clearParserCache } from "../services/source-index/parser.js";
import { setLogQuietMode } from "../utils/logger.js";

const dirs: string[] = [];
afterEach(async () => {
  clearParserCache();
  clearConfigCache();
  setLogQuietMode(false);
  await Promise.all(dirs.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), "sentinel-fidelity-"));
  dirs.push(cwd);
  await mkdir(join(cwd, "src"));
  await mkdir(join(cwd, "e2e"));
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({
      name: "fidelity",
      version: "1.0.0",
      scripts: { test: "node --test src/*.test.ts" },
      dependencies: { react: "^19.0.0" },
      devDependencies: { "@playwright/test": "^1.0.0" },
    }),
  );
  await writeFile(
    join(cwd, "src/unit.test.ts"),
    'import { test } from "node:test"; test("unit", () => {});',
  );
  await writeFile(
    join(cwd, "e2e/ui.spec.ts"),
    'import { test } from "@playwright/test"; test("ui", () => {});',
  );
  setLogQuietMode(true);
  const index = await buildSourceIndex(
    cwd,
    {
      enabled: true,
      languages: ["typescript"],
      cachePath: ".mp-sentinel-cache/source-index.json",
      maxFileSize: 512000,
    },
    true,
  );
  if (!index) throw new Error("missing fixture index");
  return { cwd, index };
}

describe("retrieval and skill fidelity", () => {
  it("keeps Vietnamese words intact and canonical-equivalent prompts identical", () => {
    const prompt = "đăng nhập trước khi sửa safeNextPath --limit src/auth.ts";
    expect(extractTaskAnchors(prompt)).toEqual(extractTaskAnchors(prompt.normalize("NFD")));
    expect(extractTaskAnchors("đăng nhập")).toEqual(["đăng", "nhập"]);
    expect(extractTaskAnchors(prompt)).not.toContain("ng");
    expect(extractTaskAnchors("trước khi sửa helper")).toEqual(["helper"]);
    expect(extractTaskAnchors(prompt)).toContain("safeNextPath");
  });

  it("separates node:test and Playwright evidence instead of labeling every test by dependency", async () => {
    const { index } = await fixture();
    const text = detectProjectConventions(index).find((c) => c.id === "test-placement")?.text;
    expect(text).toContain("Node.js node:test: 1 file(s)");
    expect(text).toContain("Playwright: 1 file(s)");
    expect(text).not.toContain("Playwright tests live");
    for (const f of index.files) f.imports = [];
    const unknown = detectProjectConventions(index).find((c) => c.id === "test-placement")?.text;
    expect(unknown).toContain("Runner not established");
    expect(unknown).not.toContain("Playwright");
  });

  it("keeps authored rules while moving generated framework detail off the bootstrap", async () => {
    const { cwd, index } = await fixture();
    const files = renderProgressiveSkill(
      index,
      {
        projectRoot: cwd,
        projectName: "fidelity",
        force: true,
        overlay: {
          path: ".mp-sentinel/skill-overlay.md",
          content: "AUTHORED: preserve our security boundary.",
        },
      },
      join(cwd, "fidelity-best-practices"),
      "fidelity-best-practices",
    );
    const skill = files.find((f) => f.outputPath.endsWith("SKILL.md"))!.content;
    const language = files.find((f) => f.outputPath.endsWith("language-patterns.md"))!.content;
    expect(skill).toContain("AUTHORED: preserve our security boundary.");
    expect(skill).not.toContain("Follow the Rules of Hooks");
    expect(language).toContain("Rules of Hooks");
    expect(skill).toContain("known file/region tasks may read source directly");
    expect(skill).toContain("not the model provider's billed usage");
    expect(Buffer.byteLength(skill)).toBeLessThan(10000);
  });

  it("template revision invalidates same-source skills with the old config hash", async () => {
    const { cwd } = await fixture();
    const args = {
      agent: "claude",
      "all-agents": false,
      "skip-index-refresh": false,
      "create-skills-no-ai-enrich": true,
      "create-skills-force": true,
    };
    expect(await runCreateSkillsCommand(args, cwd)).toBe(0);
    const path = join(cwd, ".claude/skills/fidelity-best-practices/SKILL.md");
    const current = await readFile(path, "utf8");
    const oldHash = createHash("sha256").update("{}").digest("hex").slice(0, 16);
    expect(computeGenerationConfigHash()).not.toBe(oldHash);
    await writeFile(
      path,
      current.replace(/generationConfigHash=\w+/, `generationConfigHash=${oldHash}`),
    );
    clearConfigCache();
    expect(await runCreateSkillsCommand({ ...args, "create-skills-check": true }, cwd)).toBe(1);
    await writeFile(path, current.replace(/ generationConfigHash=\w+/, ""));
    clearConfigCache();
    expect(await runCreateSkillsCommand({ ...args, "create-skills-check": true }, cwd)).toBe(1);
    await writeFile(path, current);
    clearConfigCache();
    expect(await runCreateSkillsCommand({ ...args, "create-skills-check": true }, cwd)).toBe(0);
  });
});
