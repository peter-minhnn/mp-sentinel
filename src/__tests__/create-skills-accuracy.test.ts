/**
 * Accuracy guarantees for generated skills (v3.2.7).
 *
 * Each block below pins a defect that shipped in generated output and would
 * otherwise reappear silently:
 * - tsconfig path aliases reported as npm dependencies
 * - the "N dependencies" count disagreeing with the rendered table
 * - module ownership counting test files as source files
 * - a routing row that merely repeats the fallback
 * - rule packs / conventions asserted from package.json presence alone
 * - project overlays applied to one agent's output but not the others
 */

import { describe, it, expect } from "@jest/globals";

import type {
  IndexInsights,
  ProjectManifest,
  SkillOverlay,
  SourceIndex,
  SourceIndexFile,
} from "../types/index.js";
import {
  buildIndexInsights,
  computeDependencyReach,
} from "../services/skills-generator/insights.js";
import { buildSkillKnowledgeBase } from "../services/skills-generator/knowledge-base.js";
import { generateContent } from "../services/skills-generator/content.js";
import { detectProjectConventions } from "../services/skills-generator/convention-detectors.js";
import { selectActiveRulePacks } from "../services/skills-generator/rule-packs/index.js";
import { renderProgressiveSkill } from "../services/skills-generator/adapters/skill-renderer.js";
import { renderConciseRules } from "../services/skills-generator/adapters/rule-renderer.js";
import { computeGenerationConfigHash } from "../services/skills-generator/metadata.js";
import { validateSkillQuality } from "../services/skills-generator/quality-gate.js";
import { getAdapter } from "../services/skills-generator/registry.js";
import { MAX_TRACKED_DEPENDENCIES } from "../services/skills-generator/constants.js";
import type { LanguageProfile } from "../types/index.js";

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

const imp = (source: string): SourceIndexFile["imports"][number] => ({
  source,
  kind: "named",
  names: [],
  line: 1,
});

function makeIndex(
  project: Partial<ProjectManifest>,
  files: SourceIndexFile[],
  insights?: Partial<IndexInsights>,
): SourceIndex {
  const index: SourceIndex = {
    schemaVersion: "1.2",
    generatedAt: "2026-01-01T00:00:00.000Z",
    toolVersion: "1.0.0",
    project: {
      packageName: "fixture",
      packageVersion: "1.0.0",
      ecosystem: "node",
      packageManager: "npm",
      dependencies: {},
      devDependencies: {},
      detectedFrameworks: [],
      ...project,
    },
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

/** N files under src/lib, each importing `dep`, to clear usage thresholds. */
function filesImporting(dep: string, count: number, prefix = "src/lib/mod"): SourceIndexFile[] {
  return Array.from({ length: count }, (_, i) =>
    makeFile(`${prefix}${i}.ts`, { imports: [imp(dep)] }),
  );
}

/** Padding so the index clears MIN_FILES_FOR_USAGE_SIGNALS (40). */
function padding(count: number): SourceIndexFile[] {
  return Array.from({ length: count }, (_, i) =>
    makeFile(`src/pad/p${i}.ts`, { imports: [imp("react")] }),
  );
}

const ALIAS_TSCONFIG = {
  compilerOptions: { moduleResolution: "bundler", strict: true, paths: { "@/*": ["./src/*"] } },
};

// ── tsconfig aliases are not dependencies ──────────────────────────────────

describe("dependency detection ignores tsconfig path aliases", () => {
  const index = makeIndex({ dependencies: { react: "^19.0.0" }, tsConfig: ALIAS_TSCONFIG }, [
    makeFile("src/app/page.tsx", { imports: [imp("@/lib/utils"), imp("react")] }),
    makeFile("src/lib/utils.ts", { imports: [imp("node:path")] }),
  ]);

  it("keeps npm packages and drops alias specifiers", () => {
    const insights = buildIndexInsights(index);
    expect(Object.keys(insights.dependencyUsage)).toEqual(["react"]);
  });

  it("also filters aliases that a stale index cache already recorded", () => {
    // Simulates a cache written by an older indexer: `@/lib` was persisted as
    // a package, so filtering only at index time would not be enough.
    const stale = makeIndex(
      { dependencies: { react: "^19.0.0" }, tsConfig: ALIAS_TSCONFIG },
      index.files,
      {
        dependencyUsage: {
          react: ["src/app/page.tsx"],
          "@/lib": ["src/app/page.tsx"],
        },
      },
    );
    const kb = buildSkillKnowledgeBase(stale);
    expect(kb.dependencies.map((d) => d.packageName)).toEqual(["react"]);
  });
});

// ── the advertised dependency count matches the rendered table ─────────────

describe("dependency count in SKILL.md matches dependencies.md", () => {
  it("never advertises more packages than the reference can render", () => {
    const deps: Record<string, string> = {};
    const files: SourceIndexFile[] = [];
    for (let i = 0; i < MAX_TRACKED_DEPENDENCIES + 8; i++) {
      deps[`pkg-${i}`] = "^1.0.0";
      files.push(makeFile(`src/lib/uses${i}.ts`, { imports: [imp(`pkg-${i}`)] }));
    }
    const index = makeIndex({ dependencies: deps }, files);
    index.insights = buildIndexInsights(index);
    const kb = buildSkillKnowledgeBase(index);
    const content = generateContent(index, "fixture", null, kb);

    const renderedRows = (content.sections.dependencies.match(/^\| `/gm) ?? []).length;
    expect(kb.dependencies.length).toBe(MAX_TRACKED_DEPENDENCIES);
    expect(renderedRows).toBe(kb.dependencies.length);
    expect(content.sections.agentWorkflow).toContain(`${kb.dependencies.length} dependencies`);
  });
});

// ── module ownership counts source files, not source + test ────────────────

describe("module ownership counts", () => {
  it("excludes test files from the source count", () => {
    const index = makeIndex({}, [
      makeFile("src/lib/audio/align.ts"),
      makeFile("src/lib/audio/decode.ts"),
      makeFile("src/lib/audio/align.test.ts"),
    ]);
    const kb = buildSkillKnowledgeBase(index);
    const content = generateContent(index, "fixture", null, kb);
    expect(content.sections.profileRules).toContain(
      "`src/lib/audio/` - 2 source file(s) (1 test files)",
    );
  });
});

// ── routing rows must out-inform the fallback ──────────────────────────────

describe("reference routing", () => {
  const index = makeIndex({}, [
    makeFile("src/widgets/a.ts"),
    makeFile("src/widgets/b.ts"),
    makeFile("src/panels/c.ts"),
  ]);

  it("uses a weaker fallback than any classified row", () => {
    const kb = buildSkillKnowledgeBase(index);
    const routing = generateContent(index, "fixture", null, kb).sections.referenceRouting;
    expect(routing).toContain("| Other files | codebase-map |");
  });

  it("emits no row whose references merely repeat the fallback", () => {
    const kb = buildSkillKnowledgeBase(index);
    const routing = generateContent(index, "fixture", null, kb).sections.referenceRouting;
    const dataRows = routing
      .split("\n")
      .filter((l) => l.startsWith("| ") && !l.includes("Directory Pattern") && !l.includes("---"));
    const duplicates = dataRows.filter(
      (l) => !l.includes("Other files") && l.endsWith("| codebase-map |"),
    );
    expect(duplicates).toEqual([]);
  });

  it("collapses an over-long directory list into a count", () => {
    const many = makeIndex(
      {},
      Array.from({ length: 30 }, (_, i) => makeFile(`src/dir${i}/file.ts`)),
    );
    const kb = buildSkillKnowledgeBase(many);
    const routing = generateContent(many, "fixture", null, kb).sections.referenceRouting;
    for (const row of routing.split("\n").filter((l) => l.startsWith("| `"))) {
      expect((row.match(/`/g) ?? []).length / 2).toBeLessThanOrEqual(8);
    }
  });
});

// ── rule packs and conventions need evidence of use ────────────────────────

const langProfile: LanguageProfile = {
  dominant: "typescript",
  secondary: ["tsx"],
  distribution: { typescript: 8, tsx: 2 },
  indexableShare: 1,
  nonIndexableHotspots: [],
};

describe("rule pack usage gating", () => {
  const deps = { "@tanstack/react-query": "^5.0.0" };

  it("drops a pack whose dependency barely reaches the codebase", () => {
    const selection = selectActiveRulePacks({
      langProfile,
      frameworks: ["react"],
      deps,
      depReach: { "@tanstack/react-query": 1 },
    });
    expect(selection.packs.map((p) => p.id)).not.toContain("tanstack-query");
  });

  it("keeps a pack whose dependency is wired through the app", () => {
    const selection = selectActiveRulePacks({
      langProfile,
      frameworks: ["react"],
      deps,
      depReach: { "@tanstack/react-query": 12 },
    });
    expect(selection.packs.map((p) => p.id)).toContain("tanstack-query");
  });

  it("falls back to presence when no reach data is available", () => {
    const selection = selectActiveRulePacks({ langProfile, frameworks: ["react"], deps });
    expect(selection.packs.map((p) => p.id)).toContain("tanstack-query");
  });

  it("counts one hop, so a single provider module still ranks high", () => {
    const index = makeIndex({ dependencies: { "@tanstack/react-query": "^5.0.0" } }, [
      makeFile("src/providers/query.tsx", { imports: [imp("@tanstack/react-query")] }),
      makeFile("src/app/layout.tsx", { importsFrom: ["src/providers/query.tsx"] }),
      makeFile("src/app/page.tsx", { importsFrom: ["src/providers/query.tsx"] }),
    ]);
    expect(computeDependencyReach(index)["@tanstack/react-query"]).toBe(3);
  });

  it("does not gate a small codebase, where two files are the whole stack", () => {
    const index = makeIndex(
      { dependencies: { "@supabase/supabase-js": "^2.0.0" }, detectedFrameworks: ["react"] },
      [
        makeFile("src/lib/db.ts", { imports: [imp("@supabase/supabase-js")] }),
        makeFile("src/app/page.tsx", { importsFrom: ["src/lib/db.ts"] }),
      ],
    );
    const kb = buildSkillKnowledgeBase(index);
    const content = generateContent(index, "fixture", null, kb);
    expect(content.sections.languageRules).toContain("Supabase");
  });
});

describe("state/form conventions need real imports", () => {
  it("stays silent when the state library is barely imported", () => {
    const index = makeIndex({ dependencies: { zustand: "^5.0.0" }, tsConfig: ALIAS_TSCONFIG }, [
      ...padding(45),
      makeFile("src/lib/hooks/use-toast.ts", { imports: [imp("zustand")] }),
    ]);
    const texts = detectProjectConventions(index).map((c) => c.text);
    expect(texts.join(" ")).not.toContain("Zustand");
  });

  it("reports the library once the codebase actually uses it", () => {
    const index = makeIndex({ dependencies: { zustand: "^5.0.0" }, tsConfig: ALIAS_TSCONFIG }, [
      ...padding(45),
      ...filesImporting("zustand", 4, "src/lib/store"),
    ]);
    const texts = detectProjectConventions(index).map((c) => c.text);
    expect(texts.join(" ")).toContain("Zustand");
  });
});

// ── project overlay reaches every agent ────────────────────────────────────

describe("project overlay", () => {
  const overlay: SkillOverlay = {
    path: ".mp-sentinel/skill-overlay.md",
    content: "## House Rules\n\n- Never query Supabase from a Client Component.",
  };
  const index = makeIndex({}, [makeFile("src/app/page.tsx"), makeFile("src/lib/utils.ts")]);
  const baseContext = {
    projectRoot: "/repo",
    projectName: "fixture",
    force: true,
  };

  it("renders into skill-folder output, above the generated rules", () => {
    const [skill] = renderProgressiveSkill(
      index,
      { ...baseContext, overlay },
      "/repo/.claude/skills/fixture",
      "fixture",
    );
    const body = skill!.content;
    expect(body).toContain("## Project Overlay (authoritative)");
    expect(body).toContain("Never query Supabase from a Client Component.");
    expect(body).toContain("<!-- mp-sentinel-skill-overlay:start -->");
    expect(body.indexOf("## Project Overlay (authoritative)")).toBeLessThan(
      body.indexOf("## Language & Framework Rules"),
    );
  });

  it("renders into single-file rule output too, so agents cannot drift", () => {
    const [rules] = renderConciseRules(index, { ...baseContext, overlay }, "/repo/.cursor/x.mdc", {
      titleTemplate: "{projectName} Best Practices",
    });
    expect(rules!.content).toContain("Never query Supabase from a Client Component.");
  });

  it("is absent when the project has no overlay", () => {
    const [skill] = renderProgressiveSkill(
      index,
      baseContext,
      "/repo/.claude/skills/fixture",
      "fixture",
    );
    expect(skill!.content).not.toContain("Project Overlay");
  });

  it("does not let authored prose trip checks meant for generated guidance", () => {
    // Backticked tokens that are not repository paths, plus typography the
    // generated-file ASCII contract forbids -- both are normal in an overlay.
    const messy: SkillOverlay = {
      path: ".mp-sentinel/skill-overlay.md",
      content: [
        "## House Rules",
        "",
        "- Use `top-1/2`, never `top-[50%]` \u2014 brackets are a last resort.",
        "- `react-hooks/rules-of-hooks` is an error.",
        "- Tokens live in `src/app/globals.css`.",
      ].join("\n"),
    };
    const files = renderProgressiveSkill(
      index,
      { ...baseContext, overlay: messy },
      "/repo/.claude/skills/fixture",
      "fixture",
    );
    const report = validateSkillQuality(
      files,
      "claude",
      index,
      getAdapter("claude")!.spec,
      "fixture",
    );
    const offenders = report.checks.filter(
      (c) => c.type === "unknown-path" || c.type === "risky-unicode",
    );
    expect(offenders).toEqual([]);
    // Typography is normalised rather than rejected, so the overlay author
    // never has to hand-write ASCII dashes.
    const skill = files.find((f) => f.outputPath.endsWith("SKILL.md"))!;
    expect(skill.content).toContain("brackets are a last resort");
    expect(skill.content).not.toContain("\u2014");
  });

  it("changes the generation-config hash, so --check reports stale", () => {
    const before = computeGenerationConfigHash(undefined, undefined, undefined);
    const after = computeGenerationConfigHash(undefined, undefined, overlay);
    const edited = computeGenerationConfigHash(undefined, undefined, {
      ...overlay,
      content: overlay.content + "\n- And keep RLS on.",
    });
    expect(after).not.toBe(before);
    expect(edited).not.toBe(after);
  });
});
