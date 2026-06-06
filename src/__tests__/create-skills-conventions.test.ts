/**
 * Unit tests for the convention-aware create-skills upgrades:
 * - Script-aware command rendering (prefer project scripts over raw CLI)
 * - Convention detectors (alias, feature folders, HTTP client, query keys,
 *   UI system roots)
 * - Per-module reference files (naming, thresholds, caps, content)
 * - Quality gate stack-consistency checks (known false-positive guidance)
 */

import { describe, it, expect } from "@jest/globals";

import type {
  GeneratedSkillFile,
  IndexInsights,
  ProjectManifest,
  SourceIndex,
  SourceIndexFile,
} from "../types/index.js";
import {
  renderRegenerateCommand,
  renderScriptAwareToolCommand,
  renderScriptWithArgs,
  resolveProjectScript,
} from "../services/skills-generator/package-manager.js";
import {
  buildDetectedConventionsSection,
  detectProjectConventions,
} from "../services/skills-generator/convention-detectors.js";
import {
  MAX_MODULE_REFERENCE_FILES,
  MODULE_REFERENCE_MIN_SOURCE_FILES,
  buildModuleReferences,
  safeModuleName,
  selectModuleReferenceTargets,
} from "../services/skills-generator/module-references.js";
import { buildSkillKnowledgeBase } from "../services/skills-generator/knowledge-base.js";
import { generateContent } from "../services/skills-generator/content.js";
import { renderProgressiveSkill } from "../services/skills-generator/adapters/skill-renderer.js";
import { validateSkillQuality } from "../services/skills-generator/quality-gate.js";

// ── Fixture helpers ────────────────────────────────────────────────────────

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

// ── Script-aware command rendering ─────────────────────────────────────────

describe("script-aware command rendering", () => {
  it("resolves the first existing script by priority", () => {
    const scripts = { "sentinel:skills": "mp-sentinel create-skills", build: "tsc" };
    expect(resolveProjectScript(scripts, ["agent:skills:refresh", "sentinel:skills"])).toBe(
      "sentinel:skills",
    );
    expect(resolveProjectScript(scripts, ["nope"])).toBeUndefined();
    expect(resolveProjectScript(undefined, ["x"])).toBeUndefined();
  });

  it("forwards args with -- for npm/pnpm and directly for bun", () => {
    expect(renderScriptWithArgs("pnpm", "sentinel:index", "--health --index-format json")).toBe(
      "pnpm run sentinel:index -- --health --index-format json",
    );
    expect(renderScriptWithArgs("bun", "sentinel:index", "--health")).toBe(
      "bun run sentinel:index --health",
    );
    expect(renderScriptWithArgs("npm", "sentinel:index", "")).toBe("npm run sentinel:index");
  });

  it("prefers the sentinel:index script for indexing commands", () => {
    const scripts = { "sentinel:index": "mp-sentinel indexing" };
    expect(
      renderScriptAwareToolCommand("bun", scripts, "indexing --health --index-format json"),
    ).toBe("bun run sentinel:index --health --index-format json");
    expect(
      renderScriptAwareToolCommand("pnpm", scripts, "indexing --stats --index-format json"),
    ).toBe("pnpm run sentinel:index -- --stats --index-format json");
  });

  it("prefers sentinel:context for explain-context and falls back otherwise", () => {
    const scripts = { "sentinel:context": "mp-sentinel --explain-context" };
    expect(
      renderScriptAwareToolCommand(
        "pnpm",
        scripts,
        "--explain-context --format json --files <file>",
      ),
    ).toBe("pnpm run sentinel:context -- --format json --files <file>");
    expect(renderScriptAwareToolCommand("pnpm", {}, "indexing --health")).toBe(
      "pnpm exec mp-sentinel indexing --health",
    );
    expect(renderScriptAwareToolCommand("bun", undefined, "indexing --health")).toBe(
      "bunx --bun mp-sentinel indexing --health",
    );
  });

  it("ignores a sentinel:context script whose body does not wrap explain-context", () => {
    // gems-e-approval-web style: `sentinel:context` wraps an indexing query
    const scripts = { "sentinel:context": "mp-sentinel indexing --agent-context" };
    expect(
      renderScriptAwareToolCommand(
        "bun",
        scripts,
        "--explain-context --format json --files <file>",
      ),
    ).toBe("bunx --bun mp-sentinel --explain-context --format json --files <file>");
    // The same project still gets script-aware indexing commands untouched
    expect(
      renderScriptAwareToolCommand(
        "bun",
        { ...scripts, "sentinel:index": "mp-sentinel indexing" },
        "indexing --health --index-format json",
      ),
    ).toBe("bun run sentinel:index --health --index-format json");
  });

  it("renders the regenerate command from the project refresh script when present", () => {
    expect(renderRegenerateCommand("bun", { "agent:skills:refresh": "x" })).toBe(
      "bun run agent:skills:refresh",
    );
    expect(renderRegenerateCommand("pnpm", { "sentinel:skills": "x" })).toBe(
      "pnpm run sentinel:skills",
    );
    expect(renderRegenerateCommand("pnpm", {})).toBe(
      "pnpm exec mp-sentinel create-skills --all-agents --force",
    );
  });

  it("uses project scripts in the generated agent workflow", () => {
    const idx = makeIndex(
      {
        packageManager: "bun",
        dependencies: { react: "^18.0.0" },
        scripts: {
          "sentinel:index": "mp-sentinel indexing",
          "agent:skills:refresh": "mp-sentinel create-skills --all-agents --force",
        },
      },
      [makeFile("src/App.tsx")],
    );
    const content = generateContent(idx, "fixture");
    expect(content.sections.agentWorkflow).toContain(
      "bun run sentinel:index --health --index-format json",
    );
    expect(content.sections.agentWorkflow).toContain("bun run agent:skills:refresh");
    expect(content.sections.agentWorkflow).not.toContain("npx mp-sentinel indexing");
  });
});

// ── Convention detectors ───────────────────────────────────────────────────

describe("convention detectors", () => {
  it("detects a configured and used path alias", () => {
    const idx = makeIndex({ tsConfig: { compilerOptions: { paths: { "@/*": ["./src/*"] } } } }, [
      makeFile("src/a.ts", {
        imports: [{ source: "@/lib/http", kind: "named", names: ["x"], line: 1 }],
      }),
    ]);
    const conventions = detectProjectConventions(idx);
    const alias = conventions.find((c) => c.id === "alias");
    expect(alias).toBeDefined();
    expect(alias!.text).toContain("`@/*`");
    expect(alias!.text).toContain("do not replace them");
  });

  it("detects feature-folder structure when most features share the shape", () => {
    const idx = makeIndex({}, [
      makeFile("src/features/inbox/types.ts"),
      makeFile("src/features/inbox/constants.ts"),
      makeFile("src/features/inbox/hooks/useInbox.ts"),
      makeFile("src/features/detail/types.ts"),
      makeFile("src/features/detail/constants.ts"),
      makeFile("src/features/detail/hooks/useDetail.ts"),
    ]);
    const conv = detectProjectConventions(idx).find((c) => c.id === "feature-structure");
    expect(conv).toBeDefined();
    expect(conv!.text).toContain("`types.ts`");
    expect(conv!.text).toContain("`constants.ts`");
    expect(conv!.text).toContain("feature hooks");
  });

  it("detects a central HTTP client from the import graph", () => {
    const idx = makeIndex({}, [
      makeFile("src/lib/http.ts", {
        importedBy: ["src/a.ts", "src/b.ts", "src/c.ts"],
        symbols: [{ name: "apiClient", type: "variable", line: 1, column: 0 }],
      }),
      makeFile("src/a.ts"),
      makeFile("src/b.ts"),
      makeFile("src/c.ts"),
    ]);
    const conv = detectProjectConventions(idx).find((c) => c.id === "http-client");
    expect(conv).toBeDefined();
    expect(conv!.text).toContain("src/lib/http.ts");
    expect(conv!.text).toContain("`apiClient`");
  });

  it("detects React Query key constants when the dependency exists", () => {
    const idx = makeIndex({ dependencies: { "@tanstack/react-query": "^5.0.0" } }, [
      makeFile("src/features/inbox/query-keys.ts"),
      makeFile("src/features/inbox/constants.ts", {
        symbols: [{ name: "INBOX_QUERY_KEYS", type: "variable", line: 1, column: 0 }],
      }),
    ]);
    const conv = detectProjectConventions(idx).find((c) => c.id === "query-keys");
    expect(conv).toBeDefined();
    expect(conv!.text).toContain("src/features/inbox/query-keys.ts");
  });

  it("does not report query keys without the react-query dependency", () => {
    const idx = makeIndex({}, [makeFile("src/features/inbox/query-keys.ts")]);
    expect(detectProjectConventions(idx).find((c) => c.id === "query-keys")).toBeUndefined();
  });

  it("detects a shared UI system root with its design system", () => {
    const idx = makeIndex({ dependencies: { antd: "^5.0.0" } }, [
      makeFile("src/shared/gems-ui/Button.tsx"),
      makeFile("src/shared/gems-ui/Modal.tsx"),
      makeFile("src/shared/gems-ui/Table.stories.tsx"),
    ]);
    const conv = detectProjectConventions(idx).find((c) => c.id === "ui-system");
    expect(conv).toBeDefined();
    expect(conv!.text).toContain("src/shared/gems-ui");
    expect(conv!.text).toContain("Ant Design");
    expect(conv!.text).toContain("Storybook");
  });

  it("renders an empty section when nothing is detected", () => {
    const idx = makeIndex({}, [makeFile("src/a.ts")]);
    expect(buildDetectedConventionsSection(detectProjectConventions(idx))).toBe("");
  });
});

// ── Per-module references ──────────────────────────────────────────────────

function makeFeatureHeavyIndex(): SourceIndex {
  const files: SourceIndexFile[] = [];
  for (let i = 0; i < MODULE_REFERENCE_MIN_SOURCE_FILES; i++) {
    files.push(makeFile(`src/features/inbox/file${i}.ts`));
    files.push(makeFile(`src/features/detail/file${i}.ts`));
  }
  files.push(makeFile("src/lib/util.ts"));
  return makeIndex({}, files, {});
}

describe("per-module references", () => {
  it("builds safe module file names", () => {
    expect(safeModuleName("src/features/approval-inbox")).toBe("src-features-approval-inbox");
    expect(safeModuleName("src/app/(dashboard)")).toBe("src-app-dashboard");
  });

  it("selects only modules above the source-file threshold, capped", () => {
    const kb = buildSkillKnowledgeBase(makeFeatureHeavyIndex());
    const targets = selectModuleReferenceTargets(kb);
    const dirs = targets.map((t) => t.directory);
    expect(dirs).toContain("src/features/inbox");
    expect(dirs).toContain("src/features/detail");
    expect(dirs).not.toContain("src/lib");
    expect(targets.length).toBeLessThanOrEqual(MAX_MODULE_REFERENCE_FILES);
  });

  it("builds module reference files with key files, deps, and size cap", () => {
    const index = makeFeatureHeavyIndex();
    const kb = buildSkillKnowledgeBase(index);
    const refs = buildModuleReferences(kb, index, detectProjectConventions(index));
    expect(refs.length).toBeGreaterThan(0);
    const inbox = refs.find((r) => r.directory === "src/features/inbox");
    expect(inbox).toBeDefined();
    expect(inbox!.relPath).toBe("references/modules/src-features-inbox.md");
    expect(inbox!.content).toContain("## Module: `src/features/inbox/`");
    expect(inbox!.content).toContain("### Key Files");
    expect(inbox!.content.length).toBeLessThan(6000);
  });

  it("routes directories to their module reference in the routing table", () => {
    const index = makeFeatureHeavyIndex();
    const content = generateContent(index, "fixture");
    expect(content.sections.referenceRouting).toContain("modules/src-features-inbox");
  });
});

// ── Quality gate stack consistency ─────────────────────────────────────────

function skillFile(content: string): GeneratedSkillFile[] {
  return [{ outputPath: "/tmp/skill/SKILL.md", content }];
}

const REACT_NO_NEXT = makeIndex({ dependencies: { react: "^18.0.0" }, packageManager: "bun" }, [
  makeFile("src/App.tsx"),
]);

describe("quality gate: stack consistency", () => {
  it("flags Next.js-only advice for react-without-next projects", () => {
    const report = validateSkillQuality(
      skillFile("Use next/image for images."),
      "claude",
      REACT_NO_NEXT,
    );
    expect(report.checks.some((c) => c.type === "stack-consistency")).toBe(true);
    expect(report.errors).toBeGreaterThan(0);
  });

  it("flags NodeNext .js extension advice under bundler resolution", () => {
    const idx = makeIndex({ tsConfig: { compilerOptions: { moduleResolution: "bundler" } } }, [
      makeFile("src/a.ts"),
    ]);
    const report = validateSkillQuality(
      skillFile("Internal imports must include the `.js` extension (NodeNext / ESM)."),
      "claude",
      idx,
    );
    expect(report.checks.some((c) => c.type === "stack-consistency")).toBe(true);
  });

  it("flags npm/npx workflow commands in Bun projects", () => {
    const report = validateSkillQuality(
      skillFile("Run:\n\nnpx mp-sentinel indexing --health\nnpm run build"),
      "claude",
      REACT_NO_NEXT,
    );
    const pmChecks = report.checks.filter((c) => c.type === "pm-command");
    expect(pmChecks.length).toBeGreaterThanOrEqual(2);
  });

  it("passes clean stack-consistent content", () => {
    const report = validateSkillQuality(
      skillFile("Run `bun run build` and `bunx --bun mp-sentinel indexing --health`."),
      "claude",
      REACT_NO_NEXT,
    );
    expect(report.checks.filter((c) => c.type === "stack-consistency")).toHaveLength(0);
    expect(report.checks.filter((c) => c.type === "pm-command")).toHaveLength(0);
  });

  it("does NOT flag next markers quoted inside the Project Rules section", () => {
    const content = [
      "## Project Rules (authoritative)",
      "",
      "- Do not use next/image here; this is a Vite SPA.",
      "- Avoid 'use server' directives.",
      "",
      "## Overview",
      "",
      "Plain React SPA.",
    ].join("\n");
    const report = validateSkillQuality(skillFile(content), "claude", REACT_NO_NEXT);
    expect(report.checks.filter((c) => c.type === "stack-consistency")).toHaveLength(0);
  });

  it("still flags next markers outside the Project Rules section", () => {
    const content = [
      "## Project Rules (authoritative)",
      "",
      "- Keep things simple.",
      "",
      "## Language & Framework Rules",
      "",
      "- Use next/image for images.",
    ].join("\n");
    const report = validateSkillQuality(skillFile(content), "claude", REACT_NO_NEXT);
    expect(report.checks.some((c) => c.type === "stack-consistency")).toBe(true);
  });

  it("ignores next markers inside project rules that embed a nested H2 heading", () => {
    // A project rule (or ruleFile content) carries its own Markdown H2; the
    // boundary markers must strip the WHOLE region, nested heading included.
    const idx = makeIndex({ dependencies: { react: "^18.0.0" }, packageManager: "bun" }, [
      makeFile("src/App.tsx"),
    ]);
    const kb = buildSkillKnowledgeBase(idx, undefined, {
      projectRules: [
        "Follow these notes:\n\n## Actual project facts\n\nThis is a Vite SPA - never use next/image and avoid 'use server' here.",
      ],
    });
    const content = generateContent(idx, "boundary-fixture", null, kb);
    expect(content.sections.projectRules).toContain("mp-sentinel-project-rules:start");
    expect(content.sections.projectRules).toContain("## Actual project facts");

    const files = renderProgressiveSkill(
      idx,
      {
        projectRoot: "/tmp/bench",
        projectName: "boundary-fixture",
        force: false,
        knowledgeBase: kb,
      },
      "/tmp/bench/boundary-fixture-best-practices",
      "boundary-fixture-best-practices",
    );
    const skill = files.find((f) => f.outputPath.endsWith("SKILL.md"))!;
    expect(skill.content).toContain("next/image"); // present but inside markers
    const report = validateSkillQuality([skill], "claude", idx, undefined, "boundary-fixture");
    expect(report.checks.filter((c) => c.type === "stack-consistency")).toHaveLength(0);
  });

  it("still flags the same markers when they appear outside project-rule boundaries", () => {
    const content = [
      "<!-- mp-sentinel-project-rules:start -->",
      "## Project Rules (authoritative)",
      "",
      "- Keep it simple.",
      "<!-- mp-sentinel-project-rules:end -->",
      "",
      "## Language & Framework Rules",
      "",
      "- Use next/image for images.",
    ].join("\n");
    const report = validateSkillQuality(skillFile(content), "claude", REACT_NO_NEXT);
    expect(report.checks.some((c) => c.type === "stack-consistency")).toBe(true);
  });
});

// ── Quality gate unknown-path directory handling ───────────────────────────

describe("quality gate: unknown-path directories", () => {
  it("does not warn on real directory tokens without a trailing slash", () => {
    const idx = makeIndex({ devDependencies: { typescript: "^5.5.0" } }, [
      makeFile("src/shared/gems-ui/Button.tsx"),
      makeFile("src/shared/gems-ui/Modal.tsx"),
    ]);
    // Reference a real directory with no trailing slash and no extension
    const report = validateSkillQuality(
      skillFile("Shared UI lives under `src/shared/gems-ui` and `src/shared`."),
      "claude",
      idx,
    );
    const unknownDirs = report.checks.filter(
      (c) => c.type === "unknown-path" && c.message.includes("gems-ui"),
    );
    expect(unknownDirs).toHaveLength(0);
  });

  it("treats .storybook as a known non-source directory", () => {
    const idx = makeIndex({ devDependencies: { typescript: "^5.5.0" } }, [makeFile("src/a.ts")]);
    const report = validateSkillQuality(
      skillFile("Storybook config is in `.storybook/`."),
      "claude",
      idx,
    );
    expect(
      report.checks.filter((c) => c.type === "unknown-path" && c.message.includes("storybook")),
    ).toHaveLength(0);
  });
});

// ── Project rule unicode sanitization ──────────────────────────────────────

describe("project rule unicode sanitization", () => {
  it("replaces smart quotes and dashes from project rules with ASCII", () => {
    const idx = makeIndex({ devDependencies: { typescript: "^5.5.0" } }, [makeFile("src/a.ts")]);
    const kb = buildSkillKnowledgeBase(idx, undefined, {
      projectRules: ["Use ‘single’ and “double” quotes — always → ok"],
    });
    const content = generateContent(idx, "uni-fixture", null, kb);
    expect(content.sections.projectRules).toContain("'single'");
    expect(content.sections.projectRules).toContain('"double"');
    expect(content.sections.projectRules).toContain("-- always -> ok");
    // The full skill must pass the risky-unicode gate
    const report = validateSkillQuality(
      skillFile(`## Project Rules (authoritative)\n\n${content.sections.projectRules}`),
      "claude",
      idx,
    );
    expect(report.checks.filter((c) => c.type === "risky-unicode")).toHaveLength(0);
  });
});
