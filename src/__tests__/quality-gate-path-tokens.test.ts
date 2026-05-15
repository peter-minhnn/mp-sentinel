import { describe, expect, it } from "@jest/globals";
import { validateSkillQuality } from "../services/skills-generator/quality-gate.js";
import type { GeneratedSkillFile, SourceIndex } from "../types/index.js";

function makeFile(content: string): GeneratedSkillFile {
  return {
    outputPath: ".claude/skills/test/references/architecture.md",
    content,
  };
}

function makeIndex(): SourceIndex {
  return {
    schemaVersion: "1.2",
    generatedAt: "2026-01-01T00:00:00.000Z",
    toolVersion: "3.0.0",
    project: {
      packageName: "fixture",
      packageVersion: "1.0.0",
      ecosystem: "node",
      dependencies: { next: "16.0.0", react: "19.0.0" },
      devDependencies: {},
      detectedFrameworks: ["react", "next.js"],
      tsConfig: {
        compilerOptions: {
          baseUrl: ".",
          paths: { "@/*": ["./src/*"] },
        },
      },
    },
    files: [
      {
        path: "src/index.ts",
        language: "typescript",
        sha256: "abc",
        sizeBytes: 1,
        mtimeMs: 0,
        imports: [
          { source: "@/lib/supabase/server", kind: "named", names: ["createClient"], line: 1 },
          { source: "next/image", kind: "default", names: ["Image"], line: 2 },
        ],
        exports: [],
        symbols: [],
        importsFrom: [],
        importedBy: [],
      },
    ],
    stats: { totalFiles: 1, indexedFiles: 1, skippedFiles: 0, parseErrors: 0 },
  };
}

describe("quality gate path token filtering", () => {
  it("does not report framework, API, package subpath, alias, or formatter tokens as paths", () => {
    const report = validateSkillQuality(
      [
        makeFile(
          [
            "## Architecture",
            "",
            "Use `Next.js`, `.map()`, `.filter()`, `React.memo`, and `next/image`.",
            "Aliases like `@/lib` are import prefixes, and `.prettierrc` is a formatter config.",
          ].join("\n"),
        ),
      ],
      "claude",
      makeIndex(),
    );

    expect(report.checks.filter((check) => check.type === "unknown-path")).toHaveLength(0);
  });

  it("still reports real missing source paths", () => {
    const report = validateSkillQuality(
      [makeFile("## Architecture\n\nMissing source path: `src/ghost.ts`.")],
      "claude",
      makeIndex(),
    );

    const unknownPathChecks = report.checks.filter((check) => check.type === "unknown-path");
    expect(unknownPathChecks).toHaveLength(1);
    expect(unknownPathChecks[0]!.message).toContain("src/ghost.ts");
  });
});
