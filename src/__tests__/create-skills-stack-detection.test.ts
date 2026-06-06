/**
 * Stack-aware create-skills generation tests.
 *
 * Covers the deterministic improvements:
 * - Profile detection: react-spa (Vite/CRA) vs react-next (Next.js only)
 * - Package manager detection (packageManager field, bun.lock) and
 *   command rendering (bun run / bunx --bun, pnpm run / pnpm exec)
 * - Config-aware TypeScript rules (no NodeNext `.js` rule under bundler
 *   resolution; only enabled strict flags mentioned)
 * - Framework-aware module grouping (feature-first SPA, Next App Router)
 * - Deterministic dependency packs (Vite, React Router, TanStack Query,
 *   Ant Design, Supabase)
 * - Project-authored rules rendered above generated references
 * - getToolVersion ignoring a foreign npm_package_version
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "@jest/globals";

import type {
  IndexInsights,
  ProjectManifest,
  SourceIndex,
  SourceIndexFile,
} from "../types/index.js";
import { detectProfile } from "../services/skills-generator/profile.js";
import { generateContent } from "../services/skills-generator/content.js";
import { buildSkillKnowledgeBase } from "../services/skills-generator/knowledge-base.js";
import {
  normalizePackageManager,
  renderExecPrefix,
  renderRunScript,
  renderToolCommand,
} from "../services/skills-generator/package-manager.js";
import {
  enabledStrictFlags,
  requiresJsImportExtensions,
} from "../services/skills-generator/ts-project-flags.js";
import {
  isAppEntryFile,
  isNextRouteFile,
  moduleKeyForPath,
} from "../services/skills-generator/module-grouping.js";
import { detectPackageManager } from "../services/source-index/manifest.js";
import { getToolVersion } from "../utils/version.js";

// ── Fixture helpers ────────────────────────────────────────────────────────

const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "mp-sentinel-stack-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function makeFile(path: string, overrides?: Partial<SourceIndexFile>): SourceIndexFile {
  return {
    path,
    language: path.endsWith(".tsx") ? "tsx" : "typescript",
    sha256: "abc",
    sizeBytes: 100,
    mtimeMs: 0,
    imports: [],
    exports: [],
    symbols: [
      { name: `sym_${path.replace(/[^a-zA-Z0-9]/g, "_")}`, type: "function", line: 1, column: 0 },
    ],
    importsFrom: [],
    importedBy: [],
    ...overrides,
  };
}

function makeIndex(
  project: Partial<ProjectManifest>,
  files: SourceIndexFile[],
  insights?: Partial<IndexInsights>,
): SourceIndex {
  const fullProject: ProjectManifest = {
    packageName: "fixture",
    packageVersion: "1.0.0",
    ecosystem: "node",
    packageManager: "npm",
    dependencies: {},
    devDependencies: {},
    detectedFrameworks: [],
    ...project,
  };
  const index: SourceIndex = {
    schemaVersion: "1.2",
    generatedAt: "2026-01-01T00:00:00.000Z",
    toolVersion: "1.0.0",
    project: fullProject,
    files,
    stats: {
      totalFiles: files.length,
      indexedFiles: files.length,
      skippedFiles: 0,
      parseErrors: 0,
    },
  };
  if (insights) {
    index.insights = {
      fileRoles: {},
      publicApiFiles: [],
      testMap: {},
      commandMap: {},
      dependencyUsage: {},
      defaultExportFiles: [],
      reExportFiles: [],
      typeOnlyImportFiles: [],
      dynamicImportFiles: [],
      ...insights,
    };
  }
  return index;
}

/** Vite + React + Bun feature-first SPA (mirrors gems-e-approval-web). */
function makeViteReactBunIndex(): SourceIndex {
  return makeIndex(
    {
      packageName: "gems-fixture",
      packageManager: "bun",
      dependencies: {
        react: "^18.3.0",
        "react-dom": "^18.3.0",
        "react-router-dom": "^6.26.0",
        antd: "^5.20.0",
        "@supabase/supabase-js": "^2.45.0",
        "@tanstack/react-query": "^5.51.0",
      },
      devDependencies: { vite: "^5.4.0", typescript: "^5.5.0" },
      detectedFrameworks: ["react", "vite", "typescript"],
      scripts: { dev: "vite", build: "vite build", test: "vitest run" },
      tsConfig: {
        compilerOptions: {
          moduleResolution: "bundler",
          strict: true,
          noUncheckedIndexedAccess: true,
        },
      },
    },
    [
      makeFile("src/main.tsx"),
      makeFile("src/App.tsx"),
      makeFile("src/features/approval-inbox/InboxPage.tsx"),
      makeFile("src/features/approval-inbox/useInbox.ts"),
      makeFile("src/features/approval-detail/DetailPage.tsx"),
      makeFile("src/features/approval-request/RequestForm.tsx"),
      makeFile("src/shared/gems-ui/Button.tsx"),
      makeFile("src/shared/gems-ui/Modal.tsx"),
      makeFile("src/lib/http.ts"),
      makeFile("src/app/router.tsx"),
    ],
    {},
  );
}

/** Next.js + pnpm + bundler resolution + Supabase (mirrors mvp-listening). */
function makeNextPnpmIndex(): SourceIndex {
  return makeIndex(
    {
      packageName: "mvp-fixture",
      packageManager: "pnpm",
      dependencies: {
        next: "15.0.0",
        react: "^19.0.0",
        "react-dom": "^19.0.0",
        "@supabase/ssr": "^0.5.0",
        "@supabase/supabase-js": "^2.45.0",
      },
      devDependencies: { typescript: "^5.5.0" },
      detectedFrameworks: ["react", "next.js", "typescript"],
      scripts: { dev: "next dev", build: "next build", test: "vitest run" },
      tsConfig: {
        compilerOptions: {
          moduleResolution: "bundler",
          strict: true,
          paths: { "@/*": ["./src/*"] },
        },
      },
    },
    [
      makeFile("src/app/(dashboard)/page.tsx"),
      makeFile("src/app/(dashboard)/layout.tsx"),
      makeFile("src/app/api/users/route.ts"),
      makeFile("src/app/layout.tsx"),
      makeFile("src/components/audio/Player.tsx"),
      makeFile("src/components/review/ReviewCard.tsx"),
      makeFile("src/lib/supabase/client.ts"),
      makeFile("src/lib/security/csp.ts"),
      makeFile("src/types/index.ts"),
    ],
    {},
  );
}

// ── Profile detection ──────────────────────────────────────────────────────

describe("detectProfile: react-spa vs react-next", () => {
  it("classifies Vite + React (no next) as react-spa", () => {
    expect(detectProfile(makeViteReactBunIndex())).toBe("react-spa");
  });

  it("classifies Next.js projects as react-next", () => {
    expect(detectProfile(makeNextPnpmIndex())).toBe("react-next");
  });

  it("classifies react frameworks signal without next dep as react-spa", () => {
    const idx = makeIndex({ detectedFrameworks: ["react"] }, [makeFile("src/App.tsx")]);
    expect(detectProfile(idx)).toBe("react-spa");
  });
});

// ── Package manager rendering ──────────────────────────────────────────────

describe("package manager command rendering", () => {
  it("normalizes packageManager field values", () => {
    expect(normalizePackageManager("bun@1.1.30")).toBe("bun");
    expect(normalizePackageManager("pnpm@9.0.0")).toBe("pnpm");
    expect(normalizePackageManager("weird@1.0.0")).toBe("npm");
    expect(normalizePackageManager(undefined)).toBe("npm");
  });

  it("renders bun scripts as `bun run <script>` (never `bun test`)", () => {
    expect(renderRunScript("bun", "test")).toBe("bun run test");
    expect(renderRunScript("bun", "build")).toBe("bun run build");
  });

  it("keeps npm `npm test` shorthand", () => {
    expect(renderRunScript("npm", "test")).toBe("npm test");
    expect(renderRunScript("npm", "build")).toBe("npm run build");
  });

  it("renders exec prefixes per manager", () => {
    expect(renderExecPrefix("bun")).toBe("bunx --bun");
    expect(renderExecPrefix("pnpm")).toBe("pnpm exec");
    expect(renderExecPrefix("npm")).toBe("npx");
    expect(renderToolCommand("bun", "indexing --health")).toBe(
      "bunx --bun mp-sentinel indexing --health",
    );
  });
});

describe("detectPackageManager", () => {
  it("prefers the packageManager field over conflicting lockfiles", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "x", packageManager: "bun@1.1.30" }),
    );
    await writeFile(join(cwd, "package-lock.json"), "{}");
    expect(detectPackageManager(cwd)).toBe("bun");
  });

  it("detects bun from bun.lock (text lockfile)", async () => {
    const cwd = await makeTempDir();
    await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "x" }));
    await writeFile(join(cwd, "bun.lock"), "");
    expect(detectPackageManager(cwd)).toBe("bun");
  });

  it("detects bun from bun.lockb (binary lockfile)", async () => {
    const cwd = await makeTempDir();
    await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "x" }));
    await writeFile(join(cwd, "bun.lockb"), "");
    expect(detectPackageManager(cwd)).toBe("bun");
  });

  it("detects pnpm from pnpm-lock.yaml", async () => {
    const cwd = await makeTempDir();
    await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "x" }));
    await writeFile(join(cwd, "pnpm-lock.yaml"), "");
    expect(detectPackageManager(cwd)).toBe("pnpm");
  });

  it("ignores an unknown packageManager field and falls back to lockfiles", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "x", packageManager: "mystery@1.0.0" }),
    );
    await writeFile(join(cwd, "pnpm-lock.yaml"), "");
    expect(detectPackageManager(cwd)).toBe("pnpm");
  });
});

// ── Config-aware TypeScript rules ──────────────────────────────────────────

describe("ts-project-flags", () => {
  it("does not require .js extensions under bundler resolution", () => {
    expect(requiresJsImportExtensions({ compilerOptions: { moduleResolution: "bundler" } })).toBe(
      false,
    );
  });

  it("requires .js extensions under NodeNext / node16", () => {
    expect(requiresJsImportExtensions({ compilerOptions: { moduleResolution: "NodeNext" } })).toBe(
      true,
    );
    expect(requiresJsImportExtensions({ compilerOptions: { module: "node16" } })).toBe(true);
  });

  it("defaults to NodeNext behavior without a tsconfig", () => {
    expect(requiresJsImportExtensions(undefined)).toBe(true);
  });

  it("lists only enabled strict flags", () => {
    expect(
      enabledStrictFlags({
        compilerOptions: {
          strict: true,
          noUncheckedIndexedAccess: true,
          verbatimModuleSyntax: false,
        },
      }),
    ).toEqual(["strict", "noUncheckedIndexedAccess"]);
  });
});

// ── getToolVersion ─────────────────────────────────────────────────────────

describe("getToolVersion env guard", () => {
  const savedVersion = process.env["npm_package_version"];
  const savedName = process.env["npm_package_name"];

  afterEach(() => {
    if (savedVersion === undefined) delete process.env["npm_package_version"];
    else process.env["npm_package_version"] = savedVersion;
    if (savedName === undefined) delete process.env["npm_package_name"];
    else process.env["npm_package_name"] = savedName;
  });

  it("ignores npm_package_version from a foreign package", () => {
    process.env["npm_package_version"] = "0.1.0";
    process.env["npm_package_name"] = "some-host-app";
    expect(getToolVersion()).not.toBe("0.1.0");
  });

  it("trusts npm_package_version when the script belongs to mp-sentinel", () => {
    process.env["npm_package_version"] = "9.9.9";
    process.env["npm_package_name"] = "mp-sentinel";
    expect(getToolVersion()).toBe("9.9.9");
  });
});

// ── Module grouping ────────────────────────────────────────────────────────

describe("moduleKeyForPath", () => {
  it("groups feature-first SPA paths by feature", () => {
    expect(moduleKeyForPath("src/features/approval-inbox/InboxPage.tsx")).toBe(
      "src/features/approval-inbox",
    );
    expect(moduleKeyForPath("src/shared/gems-ui/Button.tsx")).toBe("src/shared/gems-ui");
    expect(moduleKeyForPath("src/lib/http.ts")).toBe("src/lib");
  });

  it("groups Next App Router paths by route group", () => {
    expect(moduleKeyForPath("src/app/(dashboard)/page.tsx")).toBe("src/app/(dashboard)");
    expect(moduleKeyForPath("src/app/api/users/route.ts")).toBe("src/app/api");
    expect(moduleKeyForPath("src/components/audio/Player.tsx")).toBe("src/components/audio");
  });

  it("keeps plain src subdirectories and root files stable", () => {
    expect(moduleKeyForPath("src/services/foo.ts")).toBe("src/services");
    expect(moduleKeyForPath("src/main.tsx")).toBe("src");
    expect(moduleKeyForPath("index.ts")).toBe("(root)");
    expect(moduleKeyForPath("scripts/build.mjs")).toBe("scripts");
  });

  it("recognizes app entry and Next route files", () => {
    expect(isAppEntryFile("src/main.tsx")).toBe(true);
    expect(isAppEntryFile("src/app/router.tsx")).toBe(true);
    expect(isNextRouteFile("src/app/(dashboard)/page.tsx")).toBe(true);
    expect(isNextRouteFile("app/api/users/route.ts")).toBe(true);
    expect(isNextRouteFile("src/components/Page.tsx")).toBe(false);
  });
});

// ── Golden fixture: Vite + React + Bun feature-first SPA ───────────────────

describe("generated content: vite-react-bun feature-first fixture", () => {
  const index = makeViteReactBunIndex();
  const content = generateContent(index, "gems-fixture");
  const allSections = Object.values(content.sections)
    .filter((s): s is string => typeof s === "string")
    .join("\n");

  it("uses the react-spa profile, never react-next", () => {
    expect(content.profile).toBe("react-spa");
    expect(content.sections.overview).toContain("react-spa");
    expect(content.sections.profileRules).toContain("react-spa");
  });

  it("renders Bun commands, not npm/npx", () => {
    expect(content.sections.commands).toContain("bun run build");
    expect(content.sections.agentWorkflow).toContain("bunx --bun mp-sentinel");
    expect(content.sections.agentWorkflow).not.toContain("npx mp-sentinel");
    expect(content.sections.commands).not.toContain("npm run");
  });

  it("contains no Next.js-specific advice", () => {
    expect(allSections).not.toContain("Next.js Rules");
    expect(allSections).not.toContain("next/image");
    expect(allSections).not.toContain("use server");
  });

  it("does not emit the NodeNext .js-extension rule under bundler resolution", () => {
    expect(allSections).not.toContain("must include the `.js` extension");
    expect(allSections).not.toContain("NodeNext resolution");
  });

  it("maps feature-first bounded contexts in the module map", () => {
    expect(content.sections.modules).toContain("src/features/approval-inbox");
    expect(content.sections.modules).toContain("src/features/approval-detail");
    expect(content.sections.modules).toContain("src/features/approval-request");
    expect(content.sections.modules).toContain("src/shared/gems-ui");
    expect(content.sections.modules).toContain("src/lib");
  });

  it("activates the SPA dependency packs", () => {
    expect(content.sections.languageRules).toContain("Vite Rules");
    expect(content.sections.languageRules).toContain("React Router Rules");
    expect(content.sections.languageRules).toContain("TanStack Query Rules");
    expect(content.sections.languageRules).toContain("Ant Design Rules");
    expect(content.sections.languageRules).toContain("Supabase Rules");
  });

  it("mentions only enabled strict flags", () => {
    expect(content.sections.profileRules).toContain("noUncheckedIndexedAccess");
    expect(content.sections.profileRules).not.toContain("verbatimModuleSyntax");
  });
});

// ── Golden fixture: Next + pnpm + bundler + Supabase ───────────────────────

describe("generated content: next-pnpm-bundler-supabase fixture", () => {
  const index = makeNextPnpmIndex();
  const kb = buildSkillKnowledgeBase(index);
  const content = generateContent(index, "mvp-fixture", null, kb);
  const allSections = Object.values(content.sections)
    .filter((s): s is string => typeof s === "string")
    .join("\n");

  it("keeps the react-next profile", () => {
    expect(content.profile).toBe("react-next");
    expect(content.sections.languageRules).toContain("Next.js Rules");
  });

  it("renders pnpm commands", () => {
    expect(content.sections.commands).toContain("pnpm run build");
    expect(content.sections.agentWorkflow).toContain("pnpm exec mp-sentinel");
    expect(content.sections.agentWorkflow).not.toContain("npx mp-sentinel");
  });

  it("does not require .js extensions for app source under bundler resolution", () => {
    expect(allSections).not.toContain("must include the `.js` extension");
  });

  it("breaks the module map down into App Router groups and domains", () => {
    expect(content.sections.modules).toContain("src/app/(dashboard)");
    expect(content.sections.modules).toContain("src/app/api");
    expect(content.sections.modules).toContain("src/components/audio");
    expect(content.sections.modules).toContain("src/lib/supabase");
  });

  it("activates the Supabase pack", () => {
    expect(content.sections.languageRules).toContain("Supabase Rules");
    expect(content.sections.languageRules).toContain("service_role");
  });

  it("exposes Next route files as entrypoints", () => {
    const routePaths = kb.entrypoints.filter((e) => e.type === "route").map((e) => e.path);
    expect(routePaths).toContain("src/app/(dashboard)/page.tsx");
    expect(routePaths).toContain("src/app/api/users/route.ts");
    expect(content.sections.codebaseMap).toContain("[ROUTE]");
  });
});

// ── Project-authored rules in deterministic output ─────────────────────────

describe("project rules integration", () => {
  it("renders project rules above generated references and marks them authoritative", () => {
    const index = makeViteReactBunIndex();
    const kb = buildSkillKnowledgeBase(index, undefined, {
      projectRules: ["All API calls must go through src/lib/http.ts"],
      projectRuleFiles: ["docs/rules/api.md"],
    });
    const content = generateContent(index, "gems-fixture", null, kb);
    expect(content.sections.projectRules).toContain("Project Rules (authoritative)");
    expect(content.sections.projectRules).toContain(
      "All API calls must go through src/lib/http.ts",
    );
    expect(content.sections.projectRules).toContain("docs/rules/api.md");
    expect(content.sections.projectRules).toContain("project rules win");
  });

  it("omits the section when no project rules exist", () => {
    const index = makeViteReactBunIndex();
    const content = generateContent(index, "gems-fixture");
    expect(content.sections.projectRules).toBe("");
  });
});
