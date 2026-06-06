/**
 * Real-repo validation harness.
 *
 * Builds two on-disk mini projects mirroring the validation targets
 * (`gems-e-approval-web`: Vite + React + Bun feature-first SPA, and
 * `mvp-listening`: Next.js + pnpm + bundler resolution + Supabase), runs the
 * REAL create-skills pipeline (index build -> claude adapter -> files on
 * disk), and validates the generated output:
 *
 * - no known false positives (Next rules in Vite output, npm/npx in Bun
 *   output, NodeNext `.js` extension under bundler resolution)
 * - script-aware workflow commands
 * - module map with real bounded contexts + per-module references
 * - golden snapshots for SKILL.md, commands.md, codebase-map.md, and a
 *   module-specific reference (volatile metadata stripped)
 * - user-authored override files are never overwritten, even with --force
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

// ── Helpers ────────────────────────────────────────────────────────────────

const values = (overrides: Partial<CreateSkillsValues> = {}): CreateSkillsValues => ({
  agent: "claude",
  "all-agents": false,
  "create-skills-force": true,
  "skip-index-refresh": false,
  "create-skills-no-ai-enrich": true,
  ...overrides,
});

/** Strip volatile lines (metadata header carries hash + generator version). */
const stripVolatile = (content: string): string =>
  content
    .split("\n")
    .filter((line) => !line.includes("@mp-sentinel-generated"))
    .join("\n");

const writeJson = (path: string, value: unknown): Promise<void> =>
  writeFile(path, JSON.stringify(value, null, 2));

async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, ...rel.split("/"));
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, content);
  }
}

const tsx = (name: string): string =>
  `export function ${name}(): string {\n  return "${name}";\n}\n`;

// ── Fixture: gems (Vite + React + Bun, feature-first) ──────────────────────

let gemsDir: string;
let mvpDir: string;

beforeAll(async () => {
  setLogQuietMode(true);
  clearParserCache();

  // gems-e-approval-web mini fixture
  gemsDir = await mkdtemp(join(tmpdir(), "mp-sentinel-gems-"));
  await writeJson(join(gemsDir, "package.json"), {
    name: "gems-approval-fixture",
    version: "1.0.0",
    packageManager: "bun@1.1.30",
    scripts: {
      dev: "vite",
      build: "vite build",
      test: "vitest run",
      "sentinel:index": "mp-sentinel indexing",
      // gems style: named "context" but wraps an indexing query, NOT
      // --explain-context. Must not be reused for explain-context commands.
      "sentinel:context": "mp-sentinel indexing --agent-context",
      "agent:skills:refresh": "mp-sentinel create-skills --all-agents --force",
    },
    dependencies: {
      react: "^18.3.0",
      "react-dom": "^18.3.0",
      "react-router-dom": "^6.26.0",
      antd: "^5.20.0",
      "@tanstack/react-query": "^5.51.0",
      "@supabase/supabase-js": "^2.45.0",
    },
    devDependencies: { vite: "^5.4.0", typescript: "^5.5.0" },
  });
  await writeJson(join(gemsDir, "tsconfig.json"), {
    compilerOptions: {
      moduleResolution: "bundler",
      module: "ESNext",
      strict: true,
      noUncheckedIndexedAccess: true,
      paths: { "@/*": ["./src/*"] },
    },
  });
  await writeFile(join(gemsDir, "bun.lock"), "");
  await writeTree(gemsDir, {
    "src/main.tsx":
      'import { App } from "@/App";\nexport const boot = (): void => {\n  void App;\n};\n',
    "src/App.tsx": tsx("App"),
    "src/app/router.tsx": tsx("router"),
    "src/features/approval-inbox/InboxPage.tsx": tsx("InboxPage"),
    "src/features/approval-inbox/useInbox.ts": tsx("useInbox"),
    "src/features/approval-inbox/types.ts": "export interface InboxItem {\n  id: string;\n}\n",
    "src/features/approval-inbox/constants.ts":
      'export const INBOX_QUERY_KEYS = ["inbox"] as const;\n',
    "src/features/approval-inbox/api/list.ts": tsx("listInbox"),
    "src/features/approval-detail/DetailPage.tsx": tsx("DetailPage"),
    "src/features/approval-detail/types.ts": "export interface DetailItem {\n  id: string;\n}\n",
    "src/features/approval-detail/constants.ts":
      'export const DETAIL_QUERY_KEYS = ["detail"] as const;\n',
    "src/features/approval-detail/hooks/useDetail.ts": tsx("useDetail"),
    "src/features/approval-detail/api/get.ts": tsx("getDetail"),
    "src/shared/gems-ui/Button.tsx": tsx("GemsButton"),
    "src/shared/gems-ui/Modal.tsx": tsx("GemsModal"),
    "src/shared/gems-ui/Table.stories.tsx": tsx("TableStories"),
    "src/lib/http.ts": "export const apiClient = {\n  get: (url: string): string => url,\n};\n",
  });

  // mvp-listening mini fixture
  mvpDir = await mkdtemp(join(tmpdir(), "mp-sentinel-mvp-"));
  await writeJson(join(mvpDir, "package.json"), {
    name: "mvp-listening-fixture",
    version: "1.0.0",
    packageManager: "pnpm@9.12.0",
    scripts: { dev: "next dev", build: "next build", test: "vitest run" },
    dependencies: {
      next: "15.0.0",
      react: "^19.0.0",
      "react-dom": "^19.0.0",
      "@supabase/ssr": "^0.5.0",
      "@supabase/supabase-js": "^2.45.0",
    },
    devDependencies: { typescript: "^5.5.0" },
  });
  await writeJson(join(mvpDir, "tsconfig.json"), {
    compilerOptions: {
      moduleResolution: "bundler",
      module: "ESNext",
      strict: true,
      paths: { "@/*": ["./src/*"] },
    },
  });
  await writeFile(join(mvpDir, "pnpm-lock.yaml"), "");
  await writeTree(mvpDir, {
    "src/app/layout.tsx": tsx("RootLayout"),
    "src/app/(dashboard)/page.tsx": tsx("DashboardPage"),
    "src/app/(dashboard)/layout.tsx": tsx("DashboardLayout"),
    "src/app/api/users/route.ts": tsx("usersRoute"),
    "src/components/audio/Player.tsx": tsx("Player"),
    "src/components/review/ReviewCard.tsx": tsx("ReviewCard"),
    "src/lib/supabase/client.ts": tsx("supabaseClient"),
    "src/lib/security/csp.ts": tsx("csp"),
    "src/types/index.ts": "export interface Listening {\n  id: string;\n}\n",
  });

  // Generate skills for both fixtures (claude adapter)
  clearConfigCache();
  expect(await runCreateSkillsCommand(values(), gemsDir)).toBe(0);
  clearConfigCache();
  expect(await runCreateSkillsCommand(values(), mvpDir)).toBe(0);
}, 120000);

afterAll(async () => {
  setLogQuietMode(false);
  clearConfigCache();
  for (const dir of [gemsDir, mvpDir]) {
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

const gemsSkillDir = (): string =>
  join(gemsDir, ".claude", "skills", "gems-approval-fixture-best-practices");
const mvpSkillDir = (): string =>
  join(mvpDir, ".claude", "skills", "mvp-listening-fixture-best-practices");

// ── gems fixture assertions ────────────────────────────────────────────────

describe("real-repo harness: gems (vite-react-bun-feature-first)", () => {
  it("generates a SKILL.md without Vite/Bun/NodeNext false positives", async () => {
    const skill = await readFile(join(gemsSkillDir(), "SKILL.md"), "utf-8");
    expect(skill).toContain("**Profile:** react-spa");
    expect(skill).not.toContain("Next.js Rules");
    expect(skill).not.toContain("next/image");
    expect(skill).not.toContain("must include the `.js` extension");
    expect(skill).not.toContain("npx mp-sentinel");
  });

  it("prefers project scripts in workflow commands", async () => {
    const skill = await readFile(join(gemsSkillDir(), "SKILL.md"), "utf-8");
    expect(skill).toContain("bun run sentinel:index --health --index-format json");
    expect(skill).toContain("bun run agent:skills:refresh");
  });

  it("does not reuse a sentinel:context script that wraps an indexing query", async () => {
    const skill = await readFile(join(gemsSkillDir(), "SKILL.md"), "utf-8");
    // explain-context falls back to the raw CLI (script body lacks --explain-context)
    expect(skill).toContain("bunx --bun mp-sentinel --explain-context");
    expect(skill).not.toContain("bun run sentinel:context");
  });

  it("activates the SPA dependency packs", async () => {
    const skill = await readFile(join(gemsSkillDir(), "SKILL.md"), "utf-8");
    for (const label of [
      "Vite Rules",
      "React Router Rules",
      "TanStack Query Rules",
      "Ant Design Rules",
      "Supabase Rules",
    ]) {
      expect(skill).toContain(label);
    }
  });

  it("detects feature-first, alias, query-key, and UI-system conventions", async () => {
    const skill = await readFile(join(gemsSkillDir(), "SKILL.md"), "utf-8");
    expect(skill).toContain("## Detected Conventions");
    expect(skill).toContain("`@/*`");
    expect(skill).toContain("features/<feature>");
    expect(skill).toContain("src/shared/gems-ui");
  });

  it("maps feature bounded contexts and ships module references", async () => {
    const codebaseMap = await readFile(
      join(gemsSkillDir(), "references", "codebase-map.md"),
      "utf-8",
    );
    expect(codebaseMap).toContain("src/features/approval-inbox");
    expect(codebaseMap).toContain("src/features/approval-detail");
    expect(codebaseMap).toContain("src/shared/gems-ui");

    const moduleRef = join(
      gemsSkillDir(),
      "references",
      "modules",
      "src-features-approval-inbox.md",
    );
    expect(existsSync(moduleRef)).toBe(true);
    const moduleContent = await readFile(moduleRef, "utf-8");
    expect(moduleContent).toContain("## Module: `src/features/approval-inbox/`");
    expect(moduleContent).toContain("### Key Files");
  });

  it("matches golden snapshots (volatile metadata stripped)", async () => {
    const skill = await readFile(join(gemsSkillDir(), "SKILL.md"), "utf-8");
    const commands = await readFile(join(gemsSkillDir(), "references", "commands.md"), "utf-8");
    const codebaseMap = await readFile(
      join(gemsSkillDir(), "references", "codebase-map.md"),
      "utf-8",
    );
    const moduleRef = await readFile(
      join(gemsSkillDir(), "references", "modules", "src-features-approval-inbox.md"),
      "utf-8",
    );
    expect(stripVolatile(skill)).toMatchSnapshot("gems-SKILL.md");
    expect(stripVolatile(commands)).toMatchSnapshot("gems-commands.md");
    expect(stripVolatile(codebaseMap)).toMatchSnapshot("gems-codebase-map.md");
    expect(stripVolatile(moduleRef)).toMatchSnapshot("gems-module-approval-inbox.md");
  });

  it("never overwrites a user-authored override file, even with --force", async () => {
    const skillPath = join(gemsSkillDir(), "SKILL.md");
    const userContent = "# My hand-written overrides\n\nDo not touch.\n";
    await writeFile(skillPath, userContent);
    clearConfigCache();
    const exit = await runCreateSkillsCommand(values(), gemsDir);
    expect(exit).toBe(1); // all adapters skipped
    expect(await readFile(skillPath, "utf-8")).toBe(userContent);

    // Restore generated output for any later assertions
    await rm(skillPath);
    clearConfigCache();
    expect(await runCreateSkillsCommand(values(), gemsDir)).toBe(0);
  }, 60000);
});

// ── mvp fixture assertions ─────────────────────────────────────────────────

describe("real-repo harness: mvp (next-pnpm-bundler-supabase)", () => {
  it("keeps the Next profile with pnpm workflow commands", async () => {
    const skill = await readFile(join(mvpSkillDir(), "SKILL.md"), "utf-8");
    expect(skill).toContain("**Profile:** react-next");
    expect(skill).toContain("Next.js Rules");
    expect(skill).toContain("Supabase Rules");
    expect(skill).toContain("pnpm exec mp-sentinel indexing --health");
    expect(skill).not.toContain("npx mp-sentinel");
  });

  it("does not require .js import extensions under bundler resolution", async () => {
    const skill = await readFile(join(mvpSkillDir(), "SKILL.md"), "utf-8");
    const commands = await readFile(join(mvpSkillDir(), "references", "commands.md"), "utf-8");
    expect(skill).not.toContain("must include the `.js` extension");
    expect(commands).not.toContain("must include the `.js` extension");
  });

  it("breaks the codebase map into App Router groups and domains", async () => {
    const codebaseMap = await readFile(
      join(mvpSkillDir(), "references", "codebase-map.md"),
      "utf-8",
    );
    expect(codebaseMap).toContain("src/app/(dashboard)");
    expect(codebaseMap).toContain("src/app/api");
    expect(codebaseMap).toContain("src/components/audio");
    expect(codebaseMap).toContain("src/lib/supabase");
  });

  it("matches golden snapshots (volatile metadata stripped)", async () => {
    const skill = await readFile(join(mvpSkillDir(), "SKILL.md"), "utf-8");
    const commands = await readFile(join(mvpSkillDir(), "references", "commands.md"), "utf-8");
    const codebaseMap = await readFile(
      join(mvpSkillDir(), "references", "codebase-map.md"),
      "utf-8",
    );
    expect(stripVolatile(skill)).toMatchSnapshot("mvp-SKILL.md");
    expect(stripVolatile(commands)).toMatchSnapshot("mvp-commands.md");
    expect(stripVolatile(codebaseMap)).toMatchSnapshot("mvp-codebase-map.md");
  });
});
