/**
 * External-repo adoption readiness harness.
 *
 * A nested pnpm workspace fixture (web app + shared UI package + service
 * package, each with its own package.json) runs through the REAL pipeline
 * and must satisfy the adoption gates:
 *
 * - package-level manifests are discovered under workspace globs
 * - module guidance prefers the NEAREST package scripts (filter syntax),
 *   while root workspace guidance stays for root-level tasks
 * - --dry-run writes nothing into the target (no adapter outputs)
 * - no wrong package-manager commands, no framework advice without its
 *   dependency, no unresolved "read this file" paths, zero quality warnings
 */

import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";

import { runCreateSkillsCommand } from "../commands/create-skills.js";
import type { CreateSkillsValues } from "../commands/create-skills.js";
import { clearConfigCache } from "../utils/config.js";
import { clearParserCache } from "../services/source-index/parser.js";
import { setLogQuietMode } from "../utils/logger.js";
import { readIndex } from "../services/source-index/storage.js";
import { renderProgressiveSkill } from "../services/skills-generator/adapters/skill-renderer.js";
import { validateSkillQuality } from "../services/skills-generator/quality-gate.js";

const values = (overrides: Partial<CreateSkillsValues> = {}): CreateSkillsValues => ({
  agent: "claude",
  "all-agents": false,
  "create-skills-force": true,
  "skip-index-refresh": false,
  "create-skills-no-ai-enrich": true,
  ...overrides,
});

const ts = (name: string): string =>
  `export function ${name}(): string {\n  return "${name}";\n}\n`;

let monoDir: string;

async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, ...rel.split("/"));
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, content);
  }
}

beforeAll(async () => {
  setLogQuietMode(true);
  clearParserCache();

  monoDir = await mkdtemp(join(tmpdir(), "mp-sentinel-mono-"));
  await writeFile(
    join(monoDir, "package.json"),
    JSON.stringify(
      {
        name: "mono-adoption-fixture",
        version: "1.0.0",
        packageManager: "pnpm@9.12.0",
        scripts: { build: "pnpm -r build", test: "pnpm -r test" },
        devDependencies: { typescript: "^5.5.0", vitest: "^2.0.0" },
      },
      null,
      2,
    ),
  );
  await writeFile(join(monoDir, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n  - apps/*\n");
  await writeFile(join(monoDir, "pnpm-lock.yaml"), "");
  await writeFile(
    join(monoDir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { moduleResolution: "bundler", strict: true } }),
  );

  // Package-level manifests
  await writeTree(monoDir, {
    "apps/web/package.json": JSON.stringify({
      name: "@mono/web",
      scripts: { dev: "vite", build: "vite build", test: "vitest run" },
    }),
    "packages/ui/package.json": JSON.stringify({
      name: "@mono/ui",
      scripts: { build: "tsup", test: "vitest run", storybook: "storybook dev" },
    }),
    "packages/service/package.json": JSON.stringify({
      name: "@mono/service",
      scripts: { build: "tsc", test: "vitest run", dev: "tsx watch src/server.ts" },
    }),
    // Source files: enough per package to form module-reference targets
    "apps/web/src/main.ts": ts("main"),
    "apps/web/src/App.ts": ts("App"),
    "apps/web/src/pages/Home.ts": ts("Home"),
    "apps/web/src/pages/About.ts": ts("About"),
    "apps/web/src/state/store.ts": ts("store"),
    "packages/ui/src/Button.ts": ts("Button"),
    "packages/ui/src/Modal.ts": ts("Modal"),
    "packages/ui/src/Table.ts": ts("Table"),
    "packages/ui/src/Input.ts": ts("Input"),
    "packages/ui/src/theme.ts": ts("theme"),
    "packages/service/src/server.ts": ts("server"),
    "packages/service/src/routes.ts": ts("routes"),
    "packages/service/src/handlers.ts": ts("handlers"),
    "packages/service/src/db.ts": ts("db"),
    "packages/service/src/config.ts": ts("config"),
    "packages/service/src/util.test.ts": ts("testUtil"),
  });

  clearConfigCache();
  expect(await runCreateSkillsCommand(values(), monoDir)).toBe(0);
}, 120000);

afterAll(async () => {
  setLogQuietMode(false);
  clearConfigCache();
  if (monoDir) await rm(monoDir, { recursive: true, force: true });
});

const skillDir = (): string =>
  join(monoDir, ".claude", "skills", "mono-adoption-fixture-best-practices");

describe("adoption: nested workspace monorepo", () => {
  it("detects workspace packages and lists them in conventions", async () => {
    const skill = await readFile(join(skillDir(), "SKILL.md"), "utf-8");
    expect(skill).toContain("Monorepo workspace root");
    expect(skill).toContain("pnpm --filter");
    expect(skill).toContain("`@mono/ui`");
    expect(skill).toContain("`@mono/service`");
  });

  it("prefers nearest package scripts in module references", async () => {
    const uiRef = join(skillDir(), "references", "modules", "packages-ui.md");
    expect(existsSync(uiRef)).toBe(true);
    const content = await readFile(uiRef, "utf-8");
    expect(content).toContain("### Package Scripts (`@mono/ui`)");
    expect(content).toContain("pnpm --filter @mono/ui run build");
    expect(content).toContain("pnpm --filter @mono/ui run test");
    // Never the root-level plain invocation for module-local work
    expect(content).not.toContain("`pnpm run build`");
  });

  it("keeps root workspace scripts for root-level guidance", async () => {
    const commands = await readFile(join(skillDir(), "references", "commands.md"), "utf-8");
    expect(commands).toContain("pnpm run build  # pnpm -r build");
  });

  it("has zero quality warnings and no wrong-stack advice", async () => {
    const skill = await readFile(join(skillDir(), "SKILL.md"), "utf-8");
    expect(skill).not.toContain("Next.js Rules");
    expect(skill).not.toContain("React Rules");
    expect(skill).not.toContain("must include the `.js` extension");
    expect(skill).not.toMatch(/^[\s>*-]*`?npx mp-sentinel/m);

    // Full quality gate over the real index: zero errors AND zero warnings
    const index = await readIndex(join(monoDir, ".mp-sentinel-cache", "source-index.json"), {
      hydrate: "calls",
    });
    expect(index).not.toBeNull();
    const files = renderProgressiveSkill(
      index!,
      { projectRoot: monoDir, projectName: "mono-adoption-fixture", force: false },
      skillDir(),
      "mono-adoption-fixture-best-practices",
    );
    const report = validateSkillQuality(
      files,
      "claude",
      index!,
      undefined,
      "mono-adoption-fixture",
    );
    expect(report.checks.filter((c) => c.severity === "error")).toEqual([]);
    expect(report.checks.filter((c) => c.severity === "warning")).toEqual([]);
  });

  it("resolves every First Files entry to a real file in the repo", async () => {
    const skill = await readFile(join(skillDir(), "SKILL.md"), "utf-8");
    const section = skill.match(/## First Files To Read\n[\s\S]*?(?=\n## )/)?.[0] ?? "";
    const paths = [...section.matchAll(/^- `([^`]+)`/gm)].map((m) => m[1]!);
    for (const p of paths) {
      expect({ path: p, exists: existsSync(join(monoDir, p)) }).toEqual({
        path: p,
        exists: true,
      });
    }
  });
});

describe("adoption: --dry-run writes nothing", () => {
  it("previews without creating adapter outputs in a fresh copy", async () => {
    const freshDir = await mkdtemp(join(tmpdir(), "mp-sentinel-dryrun-"));
    try {
      await writeFile(
        join(freshDir, "package.json"),
        JSON.stringify({
          name: "dryrun-fixture",
          version: "1.0.0",
          scripts: { test: "vitest run" },
          devDependencies: { typescript: "^5.5.0" },
        }),
      );
      await mkdir(join(freshDir, "src"), { recursive: true });
      await writeFile(join(freshDir, "src", "index.ts"), ts("entry"));

      clearConfigCache();
      const exit = await runCreateSkillsCommand(
        values({ "create-skills-dry-run": true }),
        freshDir,
      );
      expect(exit).toBe(0);

      // No adapter outputs and no skill workspace dirs were created
      expect(existsSync(join(freshDir, ".claude"))).toBe(false);
      expect(existsSync(join(freshDir, ".agents"))).toBe(false);
      expect(existsSync(join(freshDir, "CONVENTIONS.md"))).toBe(false);
    } finally {
      clearConfigCache();
      await rm(freshDir, { recursive: true, force: true });
    }
  }, 60000);
});
