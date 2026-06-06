/**
 * Cross-project benchmark corpus for create-skills quality.
 *
 * Seven in-memory archetypes (Vite SPA, Next App Router, Node service,
 * CLI/library, monorepo root, mixed frontend/backend, minimal repo) are
 * generated through the real content pipeline and scored with the internal
 * quality harness: no stack-mismatched advice, correct package-manager
 * commands, codebase-true conventions, useful reference coverage, and
 * bounded output size. Representative outputs get snapshots; everything
 * else uses targeted assertions to stay non-brittle.
 */

import { describe, it, expect } from "@jest/globals";
import { join } from "node:path";

import type {
  IndexInsights,
  ProjectManifest,
  SourceIndex,
  SourceIndexFile,
} from "../types/index.js";
import { generateContent } from "../services/skills-generator/content.js";
import type { GeneratedContent } from "../services/skills-generator/content.js";
import { renderProgressiveSkill } from "../services/skills-generator/adapters/skill-renderer.js";
import { validateSkillQuality } from "../services/skills-generator/quality-gate.js";
import {
  computeSkillQualityScore,
  type ArchetypeExpectations,
} from "./helpers/skill-quality-score.js";

// ── Fixture helpers ────────────────────────────────────────────────────────

function makeFile(path: string, overrides?: Partial<SourceIndexFile>): SourceIndexFile {
  const language = path.endsWith(".tsx")
    ? "tsx"
    : path.endsWith(".jsx")
      ? "jsx"
      : path.endsWith(".js") || path.endsWith(".mjs")
        ? "javascript"
        : "typescript";
  return {
    path,
    language,
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
  insights: Partial<IndexInsights> | null = {},
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

// ── Archetype corpus ───────────────────────────────────────────────────────

interface Archetype {
  name: string;
  index: SourceIndex;
  expectations: ArchetypeExpectations;
}

const NEXT_ONLY_MARKERS = ["Next.js Rules", "next/image", "'use server'"];
const NODENEXT_MARKER = "must include the `.js` extension";

const ARCHETYPES: Archetype[] = [
  {
    name: "vite-spa",
    index: makeIndex(
      {
        packageName: "vite-spa-fixture",
        packageManager: "bun",
        dependencies: {
          react: "^18.3.0",
          "react-dom": "^18.3.0",
          "react-router-dom": "^6.26.0",
          "@tanstack/react-query": "^5.51.0",
          zustand: "^4.5.0",
        },
        devDependencies: { vite: "^5.4.0", typescript: "^5.5.0", vitest: "^2.0.0" },
        detectedFrameworks: ["react", "vite", "typescript", "vitest"],
        scripts: { dev: "vite", build: "vite build", test: "vitest run" },
        tsConfig: {
          compilerOptions: {
            moduleResolution: "bundler",
            strict: true,
            paths: { "@/*": ["./src/*"] },
          },
        },
      },
      [
        makeFile("src/main.tsx"),
        makeFile("src/App.tsx"),
        makeFile("src/features/billing/BillingPage.tsx"),
        makeFile("src/features/billing/types.ts"),
        makeFile("src/features/billing/hooks/useBilling.ts"),
        makeFile("src/features/accounts/AccountsPage.tsx"),
        makeFile("src/features/accounts/types.ts"),
        makeFile("src/features/accounts/hooks/useAccounts.ts"),
        makeFile("src/lib/http.ts", {
          importedBy: [
            "src/features/billing/BillingPage.tsx",
            "src/features/accounts/AccountsPage.tsx",
            "src/App.tsx",
          ],
          symbols: [{ name: "apiClient", type: "variable", line: 1, column: 0 }],
        }),
        makeFile("src/features/billing/BillingPage.test.tsx"),
      ],
    ),
    expectations: {
      packageManager: "bun",
      forbiddenMarkers: [...NEXT_ONLY_MARKERS, NODENEXT_MARKER, "npx mp-sentinel"],
      requiredSignals: [
        "react-spa",
        "bun run build",
        "bunx --bun mp-sentinel",
        "Vite Rules",
        "React Router Rules",
        "Feature-first layout",
        "Zustand",
      ],
      expectedModules: ["src/features/billing", "src/features/accounts", "src/lib"],
    },
  },
  {
    name: "next-app-router",
    index: makeIndex(
      {
        packageName: "next-fixture",
        packageManager: "pnpm",
        dependencies: {
          next: "15.0.0",
          react: "^19.0.0",
          "react-dom": "^19.0.0",
          "@supabase/supabase-js": "^2.45.0",
        },
        devDependencies: { typescript: "^5.5.0" },
        detectedFrameworks: ["react", "next.js", "typescript"],
        scripts: { dev: "next dev", build: "next build", test: "vitest run" },
        tsConfig: { compilerOptions: { moduleResolution: "bundler", strict: true } },
      },
      [
        makeFile("src/app/layout.tsx"),
        makeFile("src/app/(shop)/page.tsx"),
        makeFile("src/app/(shop)/layout.tsx"),
        makeFile("src/app/api/orders/route.ts"),
        makeFile("src/components/cart/Cart.tsx"),
        makeFile("src/lib/supabase/client.ts"),
        makeFile("src/lib/supabase/queries.ts"),
      ],
    ),
    expectations: {
      packageManager: "pnpm",
      forbiddenMarkers: [NODENEXT_MARKER, "npx mp-sentinel", "Vite Rules"],
      requiredSignals: [
        "react-next",
        "Next.js Rules",
        "Supabase Rules",
        "pnpm exec mp-sentinel",
        "pnpm run build",
      ],
      expectedModules: ["src/app/(shop)", "src/app/api", "src/lib/supabase"],
    },
  },
  {
    name: "node-service",
    index: makeIndex(
      {
        packageName: "svc-fixture",
        packageManager: "npm",
        nodeEngine: ">=20",
        dependencies: { express: "^4.19.0", "@prisma/client": "^5.18.0", zod: "^3.23.0" },
        devDependencies: { typescript: "^5.5.0", jest: "^29.0.0", prisma: "^5.18.0" },
        detectedFrameworks: ["express", "typescript", "jest"],
        scripts: { build: "tsc", test: "jest", start: "node dist/server.js" },
        tsConfig: { compilerOptions: { moduleResolution: "NodeNext", strict: true } },
      },
      [
        makeFile("src/server.ts"),
        makeFile("src/routes/orders.ts"),
        makeFile("src/routes/users.ts"),
        makeFile("src/services/order-service.ts"),
        makeFile("src/services/user-service.ts"),
        makeFile("src/db/prisma-client.ts", {
          importedBy: [
            "src/services/order-service.ts",
            "src/services/user-service.ts",
            "src/routes/orders.ts",
          ],
        }),
        makeFile("src/db/order-repository.ts"),
        makeFile("tests/orders.test.ts"),
        makeFile("tests/users.test.ts"),
      ],
    ),
    expectations: {
      packageManager: "npm",
      forbiddenMarkers: [...NEXT_ONLY_MARKERS, "Vite Rules", "React Rules", "bunx --bun"],
      requiredSignals: [
        "node-service",
        "npx mp-sentinel",
        "npm test",
        "Prisma",
        "Test Expectations",
      ],
      expectedModules: ["src/routes", "src/services", "src/db", "tests"],
    },
  },
  {
    name: "cli-library",
    index: makeIndex(
      {
        packageName: "cli-fixture",
        packageManager: "npm",
        nodeEngine: ">=20.11",
        bin: "dist/index.js",
        dependencies: { commander: "^12.0.0" },
        devDependencies: { typescript: "^5.5.0", jest: "^29.0.0" },
        detectedFrameworks: ["typescript", "jest"],
        scripts: { build: "tsup", test: "jest", lint: "eslint src" },
        tsConfig: {
          compilerOptions: {
            moduleResolution: "NodeNext",
            strict: true,
            verbatimModuleSyntax: true,
          },
        },
      },
      [
        makeFile("src/index.ts"),
        makeFile("src/cli/args.ts"),
        makeFile("src/commands/run.ts"),
        makeFile("src/utils/logger.ts", {
          importedBy: ["src/index.ts", "src/cli/args.ts", "src/commands/run.ts"],
        }),
        makeFile("src/__tests__/run.test.ts"),
      ],
    ),
    expectations: {
      packageManager: "npm",
      forbiddenMarkers: [...NEXT_ONLY_MARKERS, "Vite Rules", "React Rules"],
      requiredSignals: [
        "cli-tooling",
        NODENEXT_MARKER, // NodeNext project: .js extension rule is CORRECT here
        "import type",
        "Exit codes are a contract",
        "npm test",
      ],
      expectedModules: ["src/cli", "src/commands", "src/utils"],
    },
  },
  {
    name: "monorepo-root",
    index: makeIndex(
      {
        packageName: "mono-fixture",
        packageManager: "pnpm",
        workspaces: ["packages/*", "apps/*"],
        dependencies: {},
        devDependencies: { typescript: "^5.5.0", vitest: "^2.0.0" },
        detectedFrameworks: ["typescript", "vitest"],
        scripts: { build: "pnpm -r build", test: "pnpm -r test" },
        tsConfig: { compilerOptions: { moduleResolution: "bundler", strict: true } },
      },
      [
        makeFile("packages/core/src/index.ts"),
        makeFile("packages/core/src/parser.ts"),
        makeFile("packages/ui/src/Button.tsx"),
        makeFile("packages/ui/src/Button.test.tsx"),
        makeFile("apps/web/src/main.tsx"),
      ],
    ),
    expectations: {
      packageManager: "pnpm",
      forbiddenMarkers: [...NEXT_ONLY_MARKERS, NODENEXT_MARKER, "npx mp-sentinel"],
      requiredSignals: [
        "Monorepo workspace root",
        "pnpm --filter",
        "pnpm run build",
        "pnpm exec mp-sentinel",
      ],
      expectedModules: ["packages", "apps"],
    },
  },
  {
    name: "mixed-fullstack",
    index: makeIndex(
      {
        packageName: "mixed-fixture",
        packageManager: "npm",
        dependencies: { react: "^18.3.0", "react-dom": "^18.3.0", express: "^4.19.0" },
        devDependencies: { typescript: "^5.5.0", vite: "^5.4.0" },
        detectedFrameworks: ["react", "express", "vite", "typescript"],
        scripts: { dev: "vite", build: "vite build", test: "vitest run" },
        tsConfig: { compilerOptions: { moduleResolution: "bundler", strict: true } },
      },
      [
        makeFile("src/client/App.tsx"),
        makeFile("src/client/pages/Home.tsx"),
        makeFile("src/server/index.ts"),
        makeFile("src/server/routes/api.ts"),
        makeFile("src/shared/types.ts"),
      ],
    ),
    expectations: {
      packageManager: "npm",
      forbiddenMarkers: [...NEXT_ONLY_MARKERS, NODENEXT_MARKER, "bunx --bun"],
      requiredSignals: ["react-spa", "Vite Rules", "React Rules", "npx mp-sentinel"],
      expectedModules: ["src/client", "src/server", "src/shared"],
    },
  },
  {
    name: "minimal-repo",
    index: makeIndex(
      {
        packageName: "minimal-fixture",
        packageManager: "npm",
        dependencies: {},
        devDependencies: {},
        detectedFrameworks: [],
      },
      [makeFile("index.js"), makeFile("util.js")],
    ),
    expectations: {
      packageManager: "npm",
      forbiddenMarkers: [
        ...NEXT_ONLY_MARKERS,
        NODENEXT_MARKER,
        "Vite Rules",
        "React Rules",
        "TypeScript (Strict) Rules",
      ],
      requiredSignals: ["library", "npx mp-sentinel"],
    },
  },
];

// ── Quality score assertions (all archetypes) ──────────────────────────────

describe.each(ARCHETYPES)("benchmark archetype: $name", ({ name, index, expectations }) => {
  const content: GeneratedContent = generateContent(index, name);
  const score = computeSkillQualityScore(content, expectations);

  it("has zero stack false positives", () => {
    expect(score.foundForbidden).toEqual([]);
    expect(score.falsePositiveCount).toBe(0);
  });

  it("carries all critical signals", () => {
    expect(score.missingSignals).toEqual([]);
    expect(score.missingCriticalSignalCount).toBe(0);
  });

  it("renders only package-manager-correct commands", () => {
    expect(score.commandViolations).toEqual([]);
    expect(score.commandCorrectness).toBe(true);
  });

  it("covers the expected modules in navigable references", () => {
    expect(score.referenceCoverage).toBeGreaterThanOrEqual(0.99);
  });

  it("stays dense and bounded (no bloated output)", () => {
    expect(score.instructionDensity).toBeGreaterThan(0.8);
    expect(score.totalChars).toBeLessThan(60000);
  });

  it("passes the quality gate with zero errors AND zero warnings via the claude renderer", () => {
    const skillDir = join("/tmp/bench", `${name}-best-practices`);
    const files = renderProgressiveSkill(
      index,
      { projectRoot: "/tmp/bench", projectName: name, force: false },
      skillDir,
      `${name}-best-practices`,
    );
    const report = validateSkillQuality(files, "claude", index, undefined, name);
    const errors = report.checks.filter((c) => c.severity === "error");
    const warnings = report.checks.filter((c) => c.severity === "warning");
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });
});

// ── Monorepo package-manager / script routing regression ──────────────────

describe("monorepo script routing regression", () => {
  const mono = ARCHETYPES.find((a) => a.name === "monorepo-root")!;
  const content = generateContent(mono.index, "mono-fixture");

  it("renders pnpm workspace guidance and filter-based script routing", () => {
    expect(content.sections.detectedConventions).toContain("Monorepo workspace root");
    expect(content.sections.detectedConventions).toContain("pnpm --filter");
    expect(content.sections.detectedConventions).toContain("`packages/*`");
  });

  it("renders root scripts with the workspace package manager", () => {
    expect(content.sections.commands).toContain("pnpm run build");
    // No npm-rendered command lines (script bodies after `#` may mention pnpm -r)
    expect(content.sections.commands).not.toMatch(/^npm run/m);
  });

  it("uses npm workspace syntax for npm monorepos", () => {
    const npmMono = makeIndex(
      {
        packageName: "npm-mono",
        packageManager: "npm",
        workspaces: ["packages/*"],
        devDependencies: { typescript: "^5.5.0" },
        scripts: { test: "npm test --workspaces" },
      },
      [makeFile("packages/a/src/index.ts"), makeFile("packages/b/src/index.ts")],
    );
    const npmContent = generateContent(npmMono, "npm-mono");
    expect(npmContent.sections.detectedConventions).toContain("npm run <script> -w <package>");
  });
});

// ── Usability sections (grounded, compact) ─────────────────────────────────

describe("usability sections", () => {
  const svc = ARCHETYPES.find((a) => a.name === "node-service")!;
  const content = generateContent(svc.index, "svc-fixture");

  it("First Files To Read is grounded by hub files", () => {
    expect(content.sections.firstFilesToRead).toContain("## First Files To Read");
    expect(content.sections.firstFilesToRead).toContain("src/db/prisma-client.ts");
    expect(content.sections.firstFilesToRead).toContain("hub file");
  });

  it("Common Change Paths maps API and test work", () => {
    expect(content.sections.commonChangePaths).toContain("## Common Change Paths");
    expect(content.sections.commonChangePaths).toContain("API / data work");
    expect(content.sections.commonChangePaths).toContain("`src/routes/`");
    expect(content.sections.commonChangePaths).toContain("Tests");
    expect(content.sections.commonChangePaths).toContain("npm test");
  });

  it("keeps rule-only adapters free of the rich sections", () => {
    // sections exist on content, but rule renderer omits them by design —
    // asserted indirectly: compact workflow does not include First Files
    expect(content.sections.agentWorkflowCompact).not.toContain("First Files To Read");
  });
});

// ── Quality polish regressions ─────────────────────────────────────────────

describe("quality polish", () => {
  it("codebase-map carries module counts on headings, not repeated bullets", () => {
    // Three same-sized modules previously produced three identical
    // "- 2 source file(s), 0 test file(s)" bullets -> repetitive-output warning
    const idx = makeIndex({ devDependencies: { typescript: "^5.5.0" } }, [
      makeFile("src/alpha/a.ts"),
      makeFile("src/alpha/b.ts"),
      makeFile("src/beta/a.ts"),
      makeFile("src/beta/b.ts"),
      makeFile("src/gamma/a.ts"),
      makeFile("src/gamma/b.ts"),
    ]);
    const content = generateContent(idx, "dedupe-fixture");
    expect(content.sections.codebaseMap).toContain("(2 source / 0 test files)");
    expect(content.sections.codebaseMap).not.toContain("- 2 source file(s)");
  });

  it("First Files resolves public-api .js re-export paths to indexed sources", () => {
    const idx = makeIndex(
      { bin: "dist/index.js", devDependencies: { typescript: "^5.5.0" } },
      [
        makeFile("src/index.ts"),
        makeFile("src/cli/review.ts"),
        makeFile("src/utils/logger.ts", {
          importedBy: ["src/index.ts", "src/cli/review.ts", "src/lib.ts"],
        }),
        makeFile("src/lib.ts"),
      ],
      // publicApiFiles carries the published .js specifier, not the source path
      { publicApiFiles: ["src/cli/review.js", "src/missing/only-published.js"] },
    );
    const content = generateContent(idx, "resolve-fixture");
    expect(content.sections.firstFilesToRead).toContain("`src/cli/review.ts`");
    expect(content.sections.firstFilesToRead).not.toContain("review.js");
    // Unresolvable published-only paths are excluded from "read this" advice
    expect(content.sections.firstFilesToRead).not.toContain("only-published");
    // ...but remain in the public API reference context
    expect(content.sections.codebaseMap).toContain("src/missing/only-published.js");
  });

  it("test placement prefers dedicated dirs and drops stray colocated mentions", () => {
    const files = [
      makeFile("src/core/engine.ts"),
      ...Array.from({ length: 8 }, (_, i) => makeFile(`src/__tests__/case${i}.test.ts`)),
      ...Array.from({ length: 3 }, (_, i) => makeFile(`src/tests/flow${i}.test.ts`)),
      makeFile("src/core/engine.test.ts"), // single stray colocated test
    ];
    const idx = makeIndex(
      { devDependencies: { jest: "^29.0.0" }, scripts: { test: "jest" } },
      files,
    );
    const content = generateContent(idx, "placement-fixture");
    const testsRow = content.sections.commonChangePaths
      .split("\n")
      .find((l) => l.startsWith("| Tests"));
    expect(testsRow).toBeDefined();
    // Dominant dedicated dir first; stray colocated file (1/12) not mentioned
    expect(testsRow!).toContain("`src/__tests__/`");
    expect(testsRow!).toContain("`src/tests/`");
    expect(testsRow!).not.toContain("colocated");
    expect(testsRow!.indexOf("src/__tests__/")).toBeLessThan(testsRow!.indexOf("src/tests/"));
  });

  it("keeps the colocated mention when colocation is the dominant convention", () => {
    const files = [
      makeFile("src/a.ts"),
      makeFile("src/a.test.ts"),
      makeFile("src/b.ts"),
      makeFile("src/b.test.ts"),
    ];
    const idx = makeIndex({ scripts: { test: "vitest run" } }, files);
    const content = generateContent(idx, "colocated-fixture");
    expect(content.sections.commonChangePaths).toContain("colocated");
  });
});

// ── Large-repo reference size caps ─────────────────────────────────────────

describe("large-repo reference size caps", () => {
  // A repo big enough that modules.md and codebase-map.md would blow past the
  // 6000-char reference budget without trimming.
  function makeLargeIndex(): SourceIndex {
    const files: SourceIndexFile[] = [];
    for (let m = 0; m < 30; m++) {
      for (let f = 0; f < 6; f++) {
        const symbols = Array.from({ length: 8 }, (_, s) => ({
          name: `exportedSymbolNumber${m}_${f}_variant${s}_withAVeryDescriptiveLongName`,
          type: s % 2 === 0 ? ("function" as const) : ("class" as const),
          line: s + 1,
          column: 0,
        }));
        files.push(
          makeFile(`src/area-with-a-long-name-${m}/some-fairly-long-file-name-${f}.ts`, {
            symbols,
          }),
        );
      }
    }
    return makeIndex({ devDependencies: { typescript: "^5.5.0" } }, files);
  }

  it("trims modules.md and codebase-map.md to the 6000-char budget with a summary", () => {
    const index = makeLargeIndex();
    const files = renderProgressiveSkill(
      index,
      { projectRoot: "/tmp/bench", projectName: "large-fixture", force: false },
      "/tmp/bench/large-fixture-best-practices",
      "large-fixture-best-practices",
    );
    const modules = files.find((f) => f.outputPath.endsWith("modules.md"))!;
    const codebaseMap = files.find((f) => f.outputPath.endsWith("codebase-map.md"))!;

    expect(modules.content.length).toBeLessThanOrEqual(6000);
    expect(codebaseMap.content.length).toBeLessThanOrEqual(6000);
    expect(modules.content).toMatch(/truncated to fit the reference size budget/);
    expect(codebaseMap.content).toMatch(/truncated to fit the reference size budget/);

    // Whole adapter output still passes the quality gate (no oversize error)
    const report = validateSkillQuality(files, "claude", index, undefined, "large-fixture");
    expect(report.checks.filter((c) => c.type === "max-file-size")).toEqual([]);
  });
});

// ── Representative snapshots ───────────────────────────────────────────────

describe("representative snapshots", () => {
  it("node-service SKILL.md snapshot", () => {
    const svc = ARCHETYPES.find((a) => a.name === "node-service")!;
    const files = renderProgressiveSkill(
      svc.index,
      { projectRoot: "/tmp/bench", projectName: "svc-fixture", force: false },
      "/tmp/bench/svc-fixture-best-practices",
      "svc-fixture-best-practices",
    );
    const skill = files.find((f) => f.outputPath.endsWith("SKILL.md"))!;
    expect(skill.content).toMatchSnapshot("node-service-SKILL.md");
  });

  it("monorepo-root SKILL.md snapshot", () => {
    const mono = ARCHETYPES.find((a) => a.name === "monorepo-root")!;
    const files = renderProgressiveSkill(
      mono.index,
      { projectRoot: "/tmp/bench", projectName: "mono-fixture", force: false },
      "/tmp/bench/mono-fixture-best-practices",
      "mono-fixture-best-practices",
    );
    const skill = files.find((f) => f.outputPath.endsWith("SKILL.md"))!;
    expect(skill.content).toMatchSnapshot("monorepo-root-SKILL.md");
  });
});
