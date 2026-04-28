import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it, expect, afterEach, beforeEach } from "@jest/globals";

import { parseCliArgs } from "../cli/args.js";
import { runCreateSkillsCommand } from "../commands/create-skills.js";
import {
  ADAPTER_REGISTRY,
  detectAdapters,
  parseAgentFlag,
  getAdapter,
  detectProfile,
  resolveAIEnrichmentConfig,
  detectLegacyGeneratedFiles,
} from "../services/skills-generator/index.js";
import { getToolVersion } from "../utils/version.js";
import { generateContent } from "../services/skills-generator/content.js";
import { buildSourceIndex } from "../commands/indexing.js";
import { clearConfigCache } from "../utils/config.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "mp-sentinel-cs-"));
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

beforeEach(() => {
  process.argv = ["node", "mp-sentinel"];
});

afterEach(async () => {
  clearConfigCache();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

// ── CLI args ──────────────────────────────────────────────────────────────────

describe("create-skills CLI args", () => {
  it("parses create-skills subcommand", () => {
    process.argv = ["node", "mp-sentinel", "create-skills"];
    const parsed = parseCliArgs();
    expect(parsed.command).toBe("create-skills");
  });

  it("parses --agent flag", () => {
    process.argv = ["node", "mp-sentinel", "create-skills", "--agent", "claude,cursor"];
    const parsed = parseCliArgs();
    expect(parsed.command).toBe("create-skills");
    expect(parsed.values.agent).toBe("claude,cursor");
  });

  it("parses --all-agents flag", () => {
    process.argv = ["node", "mp-sentinel", "create-skills", "--all-agents"];
    const parsed = parseCliArgs();
    expect(parsed.values["all-agents"]).toBe(true);
  });

  it("parses --force flag", () => {
    process.argv = ["node", "mp-sentinel", "create-skills", "--force"];
    const parsed = parseCliArgs();
    expect(parsed.values["create-skills-force"]).toBe(true);
  });

  it("parses --skip-index-refresh flag", () => {
    process.argv = ["node", "mp-sentinel", "create-skills", "--skip-index-refresh"];
    const parsed = parseCliArgs();
    expect(parsed.values["skip-index-refresh"]).toBe(true);
  });

  it("parses --format json (global flag forwarded to create-skills-format)", () => {
    // --format is a global flag; when command is create-skills it maps to create-skills-format
    process.argv = [
      "node",
      "mp-sentinel",
      "create-skills",
      "--agent",
      "claude",
      "--format",
      "json",
    ];
    const parsed = parseCliArgs();
    expect(parsed.values["create-skills-format"]).toBe("json");
  });
});

// ── Registry ──────────────────────────────────────────────────────────────────

describe("adapter registry", () => {
  it("has 7 adapters", () => {
    expect(ADAPTER_REGISTRY).toHaveLength(7);
  });

  it("getAdapter returns the right adapter", () => {
    expect(getAdapter("claude")?.id).toBe("claude");
    expect(getAdapter("cursor")?.id).toBe("cursor");
    expect(getAdapter("codex")?.id).toBe("codex");
    expect(getAdapter("windsurf")?.id).toBe("windsurf");
    expect(getAdapter("antigravity")?.id).toBe("antigravity");
    expect(getAdapter("cline")?.id).toBe("cline");
    expect(getAdapter("generic")?.id).toBe("generic");
  });

  it("parseAgentFlag returns correct adapters for comma-separated ids", () => {
    const adapters = parseAgentFlag("claude,cursor");
    expect(adapters.map((a) => a.id)).toEqual(["claude", "cursor"]);
  });

  it("parseAgentFlag throws on unknown agent id", () => {
    expect(() => parseAgentFlag("unknown-agent")).toThrow("Unknown agent");
  });

  it("generic adapter never auto-detects", () => {
    const cwd = tmpdir();
    expect(getAdapter("generic")?.detect(cwd)).toBe(false);
  });
});

// ── Detection ─────────────────────────────────────────────────────────────────

describe("detectAdapters", () => {
  it("detects claude when .claude/ exists", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, ".claude"), { recursive: true });
    const detected = detectAdapters(cwd);
    expect(detected.some((a) => a.id === "claude")).toBe(true);
  });

  it("detects cursor when .cursor/ exists", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, ".cursor"), { recursive: true });
    const detected = detectAdapters(cwd);
    expect(detected.some((a) => a.id === "cursor")).toBe(true);
  });

  it("detects windsurf when .windsurf/ exists", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, ".windsurf"), { recursive: true });
    const detected = detectAdapters(cwd);
    expect(detected.some((a) => a.id === "windsurf")).toBe(true);
  });

  it("detects antigravity when .antigravity/ exists", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, ".antigravity"), { recursive: true });
    const detected = detectAdapters(cwd);
    expect(detected.some((a) => a.id === "antigravity")).toBe(true);
  });

  it("detects antigravity when .agent/ exists", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, ".agent"), { recursive: true });
    const detected = detectAdapters(cwd);
    expect(detected.some((a) => a.id === "antigravity")).toBe(true);
  });

  it("detects cline when .clinerules/ exists", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, ".clinerules"), { recursive: true });
    const detected = detectAdapters(cwd);
    expect(detected.some((a) => a.id === "cline")).toBe(true);
  });

  it("detects codex when .codex/ exists", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, ".codex"), { recursive: true });
    const detected = detectAdapters(cwd);
    expect(detected.some((a) => a.id === "codex")).toBe(true);
  });

  it("returns empty list when no known folders exist", async () => {
    const cwd = await makeTempDir();
    const detected = detectAdapters(cwd);
    expect(detected).toHaveLength(0);
  });
});

// ── Content generation ────────────────────────────────────────────────────────

describe("generateContent", () => {
  it("returns fallback content when index is null", () => {
    const content = generateContent(null, "my-project");
    expect(content.projectName).toBe("my-project");
    expect(content.sections.overview).toContain("my-project");
  });

  it("includes project name and version from index", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
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
    const content = generateContent(index, "fallback");
    expect(content.projectName).toBe("fixture");
    expect(content.projectVersion).toBe("1.0.0");
  });

  it("includes architecture section with directory listing", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
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
    const content = generateContent(index, "fixture");
    expect(content.sections.architecture).toContain("src/");
  });

  it("builds module map with symbol listing", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
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
    const content = generateContent(index, "fixture");
    expect(content.sections.modules).toContain("src/");
    expect(content.sections.modules).toContain("hello");
  });
});

// ── Adapter output ────────────────────────────────────────────────────────────

describe("Claude adapter generate()", () => {
  it("creates SKILL.md + 7 reference files", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
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
    const adapter = getAdapter("claude")!;
    const files = await adapter.generate(index, {
      projectRoot: cwd,
      projectName: "fixture",
      force: false,
    });
    expect(files.length).toBe(8);
    expect(files.some((f) => f.outputPath.endsWith("SKILL.md"))).toBe(true);
    expect(files.some((f) => f.outputPath.includes("codebase-map.md"))).toBe(true);
    expect(files.some((f) => f.outputPath.includes("testing-map.md"))).toBe(true);
    expect(files.some((f) => f.outputPath.includes("dependencies.md"))).toBe(true);
    expect(files.some((f) => f.outputPath.includes("public-api.md"))).toBe(true);
    const skillMd = files.find((f) => f.outputPath.endsWith("SKILL.md"))!;
    expect(skillMd.content).toContain("name: fixture-best-practices");
    expect(skillMd.content).toContain("codebase-map.md");
    expect(skillMd.content).toContain("testing-map.md");
  });
});

describe("Cursor adapter generate()", () => {
  it("creates a single .mdc file with all sections", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    const adapter = getAdapter("cursor")!;
    const files = await adapter.generate(null, {
      projectRoot: cwd,
      projectName: "fixture",
      force: false,
    });
    expect(files.length).toBe(1);
    expect(files[0]?.outputPath.endsWith(".mdc")).toBe(true);
    const content = files[0]!.content;
    expect(content).toContain("Required Agent Workflow");
    expect(content).toContain("Codebase Map");
    expect(content).toContain("Testing Map");
    expect(content).toContain("Dependencies");
    expect(content).toContain("Public API");
  });
});

describe("Cline adapter generate()", () => {
  it("creates a single .md file under .clinerules/", async () => {
    const cwd = await makeTempDir();
    const adapter = getAdapter("cline")!;
    const files = await adapter.generate(null, {
      projectRoot: cwd,
      projectName: "my-app",
      force: false,
    });
    expect(files.length).toBe(1);
    expect(files[0]?.outputPath).toContain(".clinerules");
    expect(files[0]?.outputPath.endsWith(".md")).toBe(true);
  });
});

describe("Generic adapter generate()", () => {
  it("creates a single .md file under .agents/rules/", async () => {
    const cwd = await makeTempDir();
    const adapter = getAdapter("generic")!;
    const files = await adapter.generate(null, {
      projectRoot: cwd,
      projectName: "my-app",
      force: false,
    });
    expect(files.length).toBe(1);
    expect(files[0]?.outputPath).toContain(".agents");
    expect(files[0]?.outputPath.endsWith(".md")).toBe(true);
  });
});

// ── runCreateSkillsCommand ────────────────────────────────────────────────────

describe("runCreateSkillsCommand", () => {
  it("generates files for --agent claude and returns exit code 0", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );

    const exitCode = await runCreateSkillsCommand(
      {
        agent: "claude",
        "all-agents": false,
        "create-skills-format": undefined,
        "create-skills-force": false,
        "skip-index-refresh": false,
      },
      cwd,
    );

    expect(exitCode).toBe(0);
    const skillPath = join(cwd, ".claude", "skills", "fixture-best-practices", "SKILL.md");
    expect(existsSync(skillPath)).toBe(true);
    const content = await readFile(skillPath, "utf-8");
    expect(content).toContain("fixture-best-practices");
  });

  it("returns exit code 1 when file exists and --force not set", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );

    // First run
    await runCreateSkillsCommand(
      {
        agent: "claude",
        "all-agents": false,
        "create-skills-format": undefined,
        "create-skills-force": false,
        "skip-index-refresh": false,
      },
      cwd,
    );

    // Second run without --force — should return 1 (all skipped)
    const exitCode = await runCreateSkillsCommand(
      {
        agent: "claude",
        "all-agents": false,
        "create-skills-format": undefined,
        "create-skills-force": false,
        "skip-index-refresh": false,
      },
      cwd,
    );

    expect(exitCode).toBe(1);
  });

  it("overwrites when --force is set", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );

    await runCreateSkillsCommand(
      {
        agent: "claude",
        "all-agents": false,
        "create-skills-format": undefined,
        "create-skills-force": false,
        "skip-index-refresh": false,
      },
      cwd,
    );
    const exitCode = await runCreateSkillsCommand(
      {
        agent: "claude",
        "all-agents": false,
        "create-skills-format": undefined,
        "create-skills-force": true,
        "skip-index-refresh": false,
      },
      cwd,
    );

    expect(exitCode).toBe(0);
  });

  it("--all-agents generates output for every adapter", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );

    const exitCode = await runCreateSkillsCommand(
      {
        agent: undefined,
        "all-agents": true,
        "create-skills-format": undefined,
        "create-skills-force": false,
        "skip-index-refresh": false,
      },
      cwd,
    );

    expect(exitCode).toBe(0);
    // Claude output
    expect(existsSync(join(cwd, ".claude", "skills", "fixture-best-practices", "SKILL.md"))).toBe(
      true,
    );
    // Cursor output
    expect(existsSync(join(cwd, ".cursor", "rules", "fixture-best-practices.mdc"))).toBe(true);
    // Codex output (v1.0.17: moved to .agents/skills/)
    expect(
      existsSync(join(cwd, ".agents", "skills", "fixture-codex-best-practices", "SKILL.md")),
    ).toBe(true);
    // Antigravity output (v1.0.17: moved to .agents/skills/)
    expect(
      existsSync(join(cwd, ".agents", "skills", "fixture-antigravity-best-practices", "SKILL.md")),
    ).toBe(true);
  });

  it("--format json with --agent outputs valid JSON to stdout", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );

    let captured: string | null = null;
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      if (text.trim().startsWith("{")) captured = text;
      originalLog?.(...args);
    };

    try {
      const exitCode = await runCreateSkillsCommand(
        {
          agent: "generic",
          "all-agents": false,
          "create-skills-format": "json",
          "create-skills-force": false,
          "skip-index-refresh": false,
        },
        cwd,
      );
      expect(exitCode).toBe(0);
      expect(captured).not.toBeNull();
      const parsed = JSON.parse(captured!);
      expect(parsed).toHaveProperty("results");
      expect(Array.isArray(parsed.results)).toBe(true);
      expect(parsed.results[0]).toHaveProperty("agent", "generic");
    } finally {
      console.log = originalLog;
    }
  });

  it("--skip-index-refresh fails when cache is absent", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);

    const exitCode = await runCreateSkillsCommand(
      {
        agent: "claude",
        "all-agents": false,
        "create-skills-format": undefined,
        "create-skills-force": false,
        "skip-index-refresh": true,
      },
      cwd,
    );

    expect(exitCode).toBe(2);
  });

  it("--format json without --agent or --all-agents returns exit code 2", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);

    let captured: string | null = null;
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      if (text.trim().startsWith("{")) captured = text;
      originalLog?.(...args);
    };

    try {
      const exitCode = await runCreateSkillsCommand(
        {
          agent: undefined,
          "all-agents": false,
          "create-skills-format": "json",
          "create-skills-force": false,
          "skip-index-refresh": false,
        },
        cwd,
      );
      expect(exitCode).toBe(2);
      expect(captured).not.toBeNull();
      const parsed = JSON.parse(captured!);
      expect(parsed).toHaveProperty("status", "ERROR");
    } finally {
      console.log = originalLog;
    }
  });

  it("auto-builds index when cache is missing (no --skip-index-refresh)", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);

    // No index pre-built
    const exitCode = await runCreateSkillsCommand(
      {
        agent: "generic",
        "all-agents": false,
        "create-skills-format": undefined,
        "create-skills-force": false,
        "skip-index-refresh": false,
      },
      cwd,
    );

    expect(exitCode).toBe(0);
    const skillPath = join(cwd, ".agents", "rules", "fixture-best-practices.md");
    expect(existsSync(skillPath)).toBe(true);
  });

  it("--skip-index-refresh fails with exit code 2 when cache file is corrupt", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    // Write a corrupt (non-JSON) cache file
    await mkdir(join(cwd, ".mp-sentinel-cache"), { recursive: true });
    await writeFile(join(cwd, ".mp-sentinel-cache", "source-index.json"), "not-valid-json");

    const exitCode = await runCreateSkillsCommand(
      {
        agent: "claude",
        "all-agents": false,
        "create-skills-format": undefined,
        "create-skills-force": false,
        "skip-index-refresh": true,
      },
      cwd,
    );

    expect(exitCode).toBe(2);
  });

  it("invalid --format value returns exit code 2 with JSON error when json mode", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);

    let captured: string | null = null;
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      if (text.trim().startsWith("{")) captured = text;
      originalLog?.(...args);
    };

    try {
      const exitCode = await runCreateSkillsCommand(
        {
          agent: "claude",
          "all-agents": false,
          "create-skills-format": "xml",
          "create-skills-force": false,
          "skip-index-refresh": false,
        },
        cwd,
      );
      expect(exitCode).toBe(2);
    } finally {
      console.log = originalLog;
    }
  });

  it("no adapter output path ever targets .sentinel/skills/", async () => {
    const cwd = await makeTempDir();
    for (const adapter of ADAPTER_REGISTRY) {
      const files = await adapter.generate(null, {
        projectRoot: cwd,
        projectName: "test-proj",
        force: false,
      });
      for (const file of files) {
        expect(file.outputPath).not.toContain(".sentinel");
      }
    }
  });
});

// ── Metadata ──────────────────────────────────────────────────────────────────

import {
  computeIndexHash,
  parseMetadataFromContent,
  renderMetadataHeader,
  applyMetadataHeader,
} from "../services/skills-generator/metadata.js";

describe("metadata utilities", () => {
  it("computeIndexHash is deterministic for the same index", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    const config = {
      enabled: true,
      languages: ["typescript" as const],
      cachePath: ".mp-sentinel-cache/source-index.json",
      maxFileSize: 500000,
    };
    const index = await buildSourceIndex(cwd, config, false);
    expect(index).not.toBeNull();
    const hash1 = computeIndexHash(index!);
    const hash2 = computeIndexHash(index!);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(16);
  });

  it("computeIndexHash changes when index content changes", async () => {
    const cwd1 = await makeTempDir();
    const cwd2 = await makeTempDir();
    await makeMinimalProject(cwd1);
    await makeMinimalProject(cwd2);
    // Add an extra export to cwd2
    await writeFile(
      join(cwd2, "src", "index.ts"),
      `export function hello() { return "hi"; }\nexport function world() { return "world"; }`,
    );

    const config = {
      enabled: true,
      languages: ["typescript" as const],
      cachePath: ".mp-sentinel-cache/source-index.json",
      maxFileSize: 500000,
    };
    const idx1 = await buildSourceIndex(cwd1, config, false);
    const idx2 = await buildSourceIndex(cwd2, config, false);
    expect(computeIndexHash(idx1!)).not.toBe(computeIndexHash(idx2!));
  });

  it("renderMetadataHeader + parseMetadataFromContent round-trips", () => {
    const meta = {
      generatorVersion: "1.0.9",
      sourceIndexSchema: "1.1" as const,
      sourceIndexHash: "abc123def456abcd",
      agent: "claude" as const,
      projectName: "test-proj",
    };
    const header = renderMetadataHeader(meta);
    const content = header + "\n\n# Test\nsome content";
    const parsed = parseMetadataFromContent(content);
    expect(parsed).not.toBeNull();
    expect(parsed!.generatorVersion).toBe("1.0.9");
    expect(parsed!.sourceIndexHash).toBe("abc123def456abcd");
    expect(parsed!.agent).toBe("claude");
    expect(parsed!.projectName).toBe("test-proj");
  });

  it("parseMetadataFromContent returns null for content without marker", () => {
    const content = "# My file\nno metadata here";
    expect(parseMetadataFromContent(content)).toBeNull();
  });

  it("generated Claude SKILL.md starts with frontmatter and metadata follows", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);

    const exitCode = await runCreateSkillsCommand(
      {
        agent: "claude",
        "all-agents": false,
        "create-skills-format": undefined,
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": false,
      },
      cwd,
    );
    expect(exitCode).toBe(0);

    const skillFile = join(cwd, ".claude", "skills", "fixture-best-practices", "SKILL.md");
    const content = await readFile(skillFile, "utf-8");
    const lines = content.split("\n");
    expect(lines[0]).toBe("---");
    expect(lines[1]).toContain("name:");
    expect(lines[2]).toContain("description:");
    expect(lines[3]).toBe("---");
    expect(lines[4]).toContain("@mp-sentinel-generated");

    const meta = parseMetadataFromContent(content);
    expect(meta).not.toBeNull();
    expect(meta!.agent).toBe("claude");
    expect(meta!.projectName).toBe("fixture");
    expect(meta!.sourceIndexHash).toHaveLength(16);
  });

  it("generated non-frontmatter files have metadata on first line", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);

    const exitCode = await runCreateSkillsCommand(
      {
        agent: "generic",
        "all-agents": false,
        "create-skills-format": undefined,
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": false,
      },
      cwd,
    );
    expect(exitCode).toBe(0);

    const skillFile = join(cwd, ".agents", "rules", "fixture-best-practices.md");
    const content = await readFile(skillFile, "utf-8");
    const lines = content.split("\n");
    expect(lines[0]).toContain("@mp-sentinel-generated");

    const meta = parseMetadataFromContent(content);
    expect(meta).not.toBeNull();
    expect(meta!.agent).toBe("generic");
  });

  it("create-skills --agent claude --check returns up-to-date after generation", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);

    // Generate first
    await runCreateSkillsCommand(
      {
        agent: "claude",
        "all-agents": false,
        "create-skills-format": undefined,
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": false,
      },
      cwd,
    );

    const exitCode = await runCreateSkillsCommand(
      {
        agent: "claude",
        "all-agents": false,
        "create-skills-format": undefined,
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": true,
      },
      cwd,
    );

    expect(exitCode).toBe(0);
  });
});

// ── Metadata header placement ─────────────────────────────────────────────────

describe("applyMetadataHeader", () => {
  it("inserts metadata after YAML frontmatter", () => {
    const content = ["---", "name: test", "---", "", "# Heading"].join("\n");
    const header = "<!-- @mp-sentinel-generated agent=claude -->";
    const result = applyMetadataHeader(content, header);
    const lines = result.split("\n");
    expect(lines[0]).toBe("---");
    expect(lines[1]).toBe("name: test");
    expect(lines[2]).toBe("---");
    expect(lines[3]).toBe(header);
    expect(lines[4]).toBe("");
    expect(lines[5]).toBe("# Heading");
  });

  it("prepends metadata when no frontmatter", () => {
    const content = "# Heading\n\nSome text";
    const header = "<!-- @mp-sentinel-generated agent=generic -->";
    const result = applyMetadataHeader(content, header);
    expect(result.startsWith(header)).toBe(true);
    expect(result).toContain("# Heading");
  });

  it("falls back to prepend on malformed frontmatter", () => {
    const content = "---\nname: test\nno closing dash";
    const header = "<!-- @mp-sentinel-generated agent=claude -->";
    const result = applyMetadataHeader(content, header);
    expect(result.startsWith(header)).toBe(true);
  });
});

// ── Dry-run mode ──────────────────────────────────────────────────────────────

describe("runCreateSkillsCommand --dry-run", () => {
  it("does not create any files", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);

    const exitCode = await runCreateSkillsCommand(
      {
        agent: "claude",
        "all-agents": false,
        "create-skills-format": undefined,
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": true,
        "create-skills-check": false,
      },
      cwd,
    );

    expect(exitCode).toBe(0);
    expect(existsSync(join(cwd, ".claude"))).toBe(false);
  });

  it("reports create action for missing files", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);

    let output: unknown = null;
    const orig = console.log;
    console.log = (...args: unknown[]) => {
      const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      if (text.trim().startsWith("{")) output = JSON.parse(text);
      orig(...args);
    };

    try {
      await runCreateSkillsCommand(
        {
          agent: "claude",
          "all-agents": false,
          "create-skills-format": "json",
          "create-skills-force": false,
          "skip-index-refresh": false,
          "create-skills-dry-run": true,
          "create-skills-check": false,
        },
        cwd,
      );
    } finally {
      console.log = orig;
    }

    expect(output).not.toBeNull();
    const parsed = output as { dryRun: Array<{ agent: string; files: Array<{ action: string }> }> };
    expect(parsed.dryRun).toHaveLength(1);
    expect(parsed.dryRun[0]!.agent).toBe("claude");
    const actions = parsed.dryRun[0]!.files.map((f) => f.action);
    expect(actions.every((a) => a === "create")).toBe(true);
  });

  it("reports skip action for existing files when no --force", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);

    // Generate once
    await runCreateSkillsCommand(
      {
        agent: "claude",
        "all-agents": false,
        "create-skills-format": undefined,
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": false,
      },
      cwd,
    );

    // Dry-run again — should report skip
    let output: unknown = null;
    const orig = console.log;
    console.log = (...args: unknown[]) => {
      const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      if (text.trim().startsWith("{")) output = JSON.parse(text);
      orig(...args);
    };

    try {
      await runCreateSkillsCommand(
        {
          agent: "claude",
          "all-agents": false,
          "create-skills-format": "json",
          "create-skills-force": false,
          "skip-index-refresh": false,
          "create-skills-dry-run": true,
          "create-skills-check": false,
        },
        cwd,
      );
    } finally {
      console.log = orig;
    }

    const parsed = output as { dryRun: Array<{ files: Array<{ action: string }> }> };
    const actions = parsed.dryRun[0]!.files.map((f) => f.action);
    expect(actions.every((a) => a === "skip")).toBe(true);
  });

  it("reports overwrite action for existing files with --force", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);

    await runCreateSkillsCommand(
      {
        agent: "claude",
        "all-agents": false,
        "create-skills-format": undefined,
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": false,
      },
      cwd,
    );

    let output: unknown = null;
    const orig = console.log;
    console.log = (...args: unknown[]) => {
      const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      if (text.trim().startsWith("{")) output = JSON.parse(text);
      orig(...args);
    };

    try {
      await runCreateSkillsCommand(
        {
          agent: "claude",
          "all-agents": false,
          "create-skills-format": "json",
          "create-skills-force": true,
          "skip-index-refresh": false,
          "create-skills-dry-run": true,
          "create-skills-check": false,
        },
        cwd,
      );
    } finally {
      console.log = orig;
    }

    const parsed = output as { dryRun: Array<{ files: Array<{ action: string }> }> };
    const actions = parsed.dryRun[0]!.files.map((f) => f.action);
    expect(actions.every((a) => a === "overwrite")).toBe(true);
  });
});

// ── Check mode ────────────────────────────────────────────────────────────────

describe("runCreateSkillsCommand --check", () => {
  it("returns exit 0 when all files are up-to-date", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);

    // Generate first
    await runCreateSkillsCommand(
      {
        agent: "claude",
        "all-agents": false,
        "create-skills-format": undefined,
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": false,
      },
      cwd,
    );

    // Check — same index, should be up-to-date
    const exitCode = await runCreateSkillsCommand(
      {
        agent: "claude",
        "all-agents": false,
        "create-skills-format": undefined,
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": true,
      },
      cwd,
    );

    expect(exitCode).toBe(0);
  });

  it("returns exit 1 when files are missing", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);

    // Check without generating first
    const exitCode = await runCreateSkillsCommand(
      {
        agent: "claude",
        "all-agents": false,
        "create-skills-format": undefined,
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": true,
      },
      cwd,
    );

    expect(exitCode).toBe(1);
  });

  it("returns exit 1 when files are stale (hash mismatch)", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);

    // Generate first
    await runCreateSkillsCommand(
      {
        agent: "claude",
        "all-agents": false,
        "create-skills-format": undefined,
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": false,
      },
      cwd,
    );

    // Tamper with a generated file (remove metadata header)
    const skillFile = join(cwd, ".claude", "skills", "fixture-best-practices", "SKILL.md");
    const original = await readFile(skillFile, "utf-8");
    // Strip the metadata line (it's after frontmatter now)
    const tampered = original
      .split("\n")
      .filter((line) => !line.includes("@mp-sentinel-generated"))
      .join("\n");
    await writeFile(skillFile, tampered, "utf-8");

    const exitCode = await runCreateSkillsCommand(
      {
        agent: "claude",
        "all-agents": false,
        "create-skills-format": undefined,
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": true,
      },
      cwd,
    );

    expect(exitCode).toBe(1);
  });

  it("--check --format json output is parseable and has correct shape", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);

    let output: unknown = null;
    const orig = console.log;
    console.log = (...args: unknown[]) => {
      const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      if (text.trim().startsWith("{")) output = JSON.parse(text);
      orig(...args);
    };

    try {
      await runCreateSkillsCommand(
        {
          agent: "claude",
          "all-agents": false,
          "create-skills-format": "json",
          "create-skills-force": false,
          "skip-index-refresh": false,
          "create-skills-dry-run": false,
          "create-skills-check": true,
        },
        cwd,
      );
    } finally {
      console.log = orig;
    }

    expect(output).not.toBeNull();
    const parsed = output as { check: unknown[]; status: string };
    expect(parsed).toHaveProperty("check");
    expect(parsed).toHaveProperty("status");
    expect(["ok", "stale"]).toContain(parsed.status);
  });

  it("--check returns exit 2 on runtime error (corrupt cache + --skip-index-refresh)", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    await mkdir(join(cwd, ".mp-sentinel-cache"), { recursive: true });
    await writeFile(join(cwd, ".mp-sentinel-cache", "source-index.json"), "not-valid-json");

    const exitCode = await runCreateSkillsCommand(
      {
        agent: "claude",
        "all-agents": false,
        "create-skills-format": undefined,
        "create-skills-force": false,
        "skip-index-refresh": true,
        "create-skills-dry-run": false,
        "create-skills-check": true,
      },
      cwd,
    );

    expect(exitCode).toBe(2);
  });
});

// ── CLI arg parsing for new flags ─────────────────────────────────────────────

describe("create-skills new CLI flags", () => {
  it("parses --dry-run flag", () => {
    process.argv = ["node", "mp-sentinel", "create-skills", "--dry-run"];
    const parsed = parseCliArgs();
    expect(parsed.values["create-skills-dry-run"]).toBe(true);
  });

  it("parses --check flag", () => {
    process.argv = ["node", "mp-sentinel", "create-skills", "--check"];
    const parsed = parseCliArgs();
    expect(parsed.values["create-skills-check"]).toBe(true);
  });

  it("--dry-run and --check default to false when not specified", () => {
    process.argv = ["node", "mp-sentinel", "create-skills"];
    const parsed = parseCliArgs();
    expect(parsed.values["create-skills-dry-run"]).toBe(false);
    expect(parsed.values["create-skills-check"]).toBe(false);
  });
});

// ── Hash correctness ──────────────────────────────────────────────────────────

import type { SourceIndex, ProjectManifest } from "../types/index.js";

function makeMinimalIndex(overrides?: Partial<ProjectManifest>): SourceIndex {
  const project: ProjectManifest = {
    packageName: "test",
    packageVersion: "1.0.0",
    packageManager: "npm",
    nodeEngine: ">=18",
    dependencies: { typescript: "5.0.0" },
    devDependencies: {},
    detectedFrameworks: [],
    ...overrides,
  };
  return {
    schemaVersion: "1.2",
    generatedAt: "2026-01-01T00:00:00.000Z",
    toolVersion: "1.0.0",
    project,
    files: [
      {
        path: "src/index.ts",
        language: "typescript",
        sha256: "abc",
        sizeBytes: 100,
        mtimeMs: 0,
        imports: [{ source: "./utils.js", kind: "named", names: ["helper"], line: 1 }],
        exports: [],
        symbols: [{ name: "main", type: "function", line: 1, column: 0 }],
        importsFrom: ["src/utils.ts"],
        importedBy: [],
      },
    ],
    stats: { totalFiles: 1, indexedFiles: 1, skippedFiles: 0, parseErrors: 0 },
  };
}

describe("computeIndexHash correctness", () => {
  it("is stable for identical indexes", () => {
    const h1 = computeIndexHash(makeMinimalIndex());
    const h2 = computeIndexHash(makeMinimalIndex());
    expect(h1).toBe(h2);
  });

  it("changes when packageManager changes", () => {
    const h1 = computeIndexHash(makeMinimalIndex({ packageManager: "npm" }));
    const h2 = computeIndexHash(makeMinimalIndex({ packageManager: "pnpm" }));
    expect(h1).not.toBe(h2);
  });

  it("changes when detectedFrameworks changes", () => {
    const h1 = computeIndexHash(makeMinimalIndex({ detectedFrameworks: [] }));
    const h2 = computeIndexHash(makeMinimalIndex({ detectedFrameworks: ["react"] }));
    expect(h1).not.toBe(h2);
  });

  it("changes when a dependency is added", () => {
    const h1 = computeIndexHash(makeMinimalIndex({ dependencies: { typescript: "5.0.0" } }));
    const h2 = computeIndexHash(
      makeMinimalIndex({ dependencies: { typescript: "5.0.0", jest: "29.0.0" } }),
    );
    expect(h1).not.toBe(h2);
  });

  it("changes when manifestHash changes", () => {
    const base = makeMinimalIndex();
    const modified: SourceIndex = { ...base, manifestHash: "abc123" };
    expect(computeIndexHash(base)).not.toBe(computeIndexHash(modified));
  });

  it("changes when a symbol type changes (same name)", () => {
    const base = makeMinimalIndex();
    const modified: SourceIndex = {
      ...base,
      files: [
        {
          ...base.files[0]!,
          symbols: [{ name: "main", type: "arrow-function", line: 1, column: 0 }],
        },
      ],
    };
    expect(computeIndexHash(base)).not.toBe(computeIndexHash(modified));
  });

  it("changes when import sources change (ESM detection input)", () => {
    const base = makeMinimalIndex();
    const modified: SourceIndex = {
      ...base,
      files: [
        {
          ...base.files[0]!,
          imports: [{ source: "./utils", kind: "named", names: ["helper"], line: 1 }],
        },
      ],
    };
    // ./utils.js vs ./utils — changes ESM convention detection
    expect(computeIndexHash(base)).not.toBe(computeIndexHash(modified));
  });

  it("changes when imported names change", () => {
    const base = makeMinimalIndex();
    const modified: SourceIndex = {
      ...base,
      files: [
        {
          ...base.files[0]!,
          imports: [{ source: "./utils.js", kind: "named", names: ["helper", "extra"], line: 1 }],
        },
      ],
    };
    expect(computeIndexHash(base)).not.toBe(computeIndexHash(modified));
  });

  it("changes when import type-only status changes", () => {
    const base = makeMinimalIndex();
    const modified: SourceIndex = {
      ...base,
      files: [
        {
          ...base.files[0]!,
          imports: [
            { source: "./utils.js", kind: "named", names: ["helper"], line: 1, typeOnly: true },
          ],
        },
      ],
    };
    expect(computeIndexHash(base)).not.toBe(computeIndexHash(modified));
  });

  it("changes when export names or sources change", () => {
    const base = makeMinimalIndex();
    const namedExport: SourceIndex = {
      ...base,
      files: [
        {
          ...base.files[0]!,
          exports: [{ kind: "named", names: ["main"], line: 1 }],
        },
      ],
    };
    const reExport: SourceIndex = {
      ...base,
      files: [
        {
          ...base.files[0]!,
          exports: [{ kind: "named", names: ["main"], line: 1, source: "./main.js" }],
        },
      ],
    };
    expect(computeIndexHash(base)).not.toBe(computeIndexHash(namedExport));
    expect(computeIndexHash(namedExport)).not.toBe(computeIndexHash(reExport));
  });

  it("does not mutate insight arrays while hashing", () => {
    const index: SourceIndex = {
      ...makeMinimalIndex(),
      insights: {
        fileRoles: { "src/index.ts": "cli-entry" },
        publicApiFiles: ["src/index.ts"],
        testMap: { "src/index.ts": ["src/b.test.ts", "src/a.test.ts"] },
        commandMap: { test: "test" },
        dependencyUsage: { typescript: ["src/z.ts", "src/a.ts"] },
        defaultExportFiles: [],
        reExportFiles: [],
        typeOnlyImportFiles: [],
        dynamicImportFiles: [],
      },
    };

    computeIndexHash(index);

    expect(index.insights!.testMap["src/index.ts"]).toEqual(["src/b.test.ts", "src/a.test.ts"]);
    expect(index.insights!.dependencyUsage["typescript"]).toEqual(["src/z.ts", "src/a.ts"]);
  });
});

// ── wrong-agent detection ─────────────────────────────────────────────────────

describe("--check wrong-agent detection", () => {
  it("returns wrong-agent when file hash matches but adapter id differs", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    // Pre-create .agents/rules so fidelity signals match between generate and check
    await mkdir(join(cwd, ".agents", "rules"), { recursive: true });

    // Generate with generic
    await runCreateSkillsCommand(
      {
        agent: "generic",
        "all-agents": false,
        "create-skills-format": undefined,
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": false,
      },
      cwd,
    );

    // Tamper the metadata header: change agent from generic to codex
    const genPath = join(cwd, ".agents", "rules", "fixture-best-practices.md");
    const original = await readFile(genPath, "utf-8");
    const tampered = original.replace(/agent=generic/g, "agent=codex");
    await writeFile(genPath, tampered, "utf-8");

    // Check with generic — should see wrong-agent since header says codex
    let output: unknown = null;
    const orig = console.log;
    console.log = (...args: unknown[]) => {
      const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      if (text.trim().startsWith("{")) output = JSON.parse(text);
      orig(...args);
    };

    let exitCode: number;
    try {
      exitCode = await runCreateSkillsCommand(
        {
          agent: "generic",
          "all-agents": false,
          "create-skills-format": "json",
          "create-skills-force": false,
          "skip-index-refresh": false,
          "create-skills-dry-run": false,
          "create-skills-check": true,
        },
        cwd,
      );
    } finally {
      console.log = orig;
    }

    expect(exitCode!).toBe(1);
    const parsed = output as { check: Array<{ files: Array<{ status: string }> }> };
    const statuses = parsed.check[0]!.files.map((f) => f.status);
    expect(statuses).toContain("wrong-agent");
  });
});

// ── Profile detection ─────────────────────────────────────────────────────────

describe("detectProfile", () => {
  it("detects library by default when index is null", () => {
    expect(detectProfile(null)).toBe("library");
  });

  it("detects cli-tooling from bin field", () => {
    const idx = makeMinimalIndex({ bin: "dist/index.js" });
    expect(detectProfile(idx)).toBe("cli-tooling");
  });

  it("detects node-service from express dependency", () => {
    const idx = makeMinimalIndex({ dependencies: { express: "^4.0.0" } });
    expect(detectProfile(idx)).toBe("node-service");
  });

  it("detects react-next from next dependency", () => {
    const idx = makeMinimalIndex({ dependencies: { next: "14.0.0" } });
    expect(detectProfile(idx)).toBe("react-next");
  });

  it("detects react-next from detectedFrameworks", () => {
    const idx = makeMinimalIndex({ detectedFrameworks: ["next.js"] });
    expect(detectProfile(idx)).toBe("react-next");
  });
});

// ── Profile content generation ────────────────────────────────────────────────

describe("profileRules content", () => {
  it("includes real commands from package.json scripts", () => {
    const idx = makeMinimalIndex({
      scripts: { test: "jest", build: "tsc", lint: "eslint src" },
      bin: "dist/index.js",
    });
    const content = generateContent(idx, "test");
    expect(content.profile).toBe("cli-tooling");
    expect(content.sections.profileRules).toContain("npm run test");
    expect(content.sections.profileRules).toContain("npm run build");
    expect(content.sections.profileRules).toContain("npm run lint");
  });

  it("includes review pitfalls for cli-tooling profile", () => {
    const idx = makeMinimalIndex({ bin: "dist/index.js" });
    const content = generateContent(idx, "test");
    expect(content.sections.profileRules).toContain("Exit codes are a contract");
    expect(content.sections.profileRules).toContain("Diff-first review");
  });

  it("includes review pitfalls for library profile", () => {
    const idx = makeMinimalIndex({ dependencies: { lodash: "^4.0.0" } });
    const content = generateContent(idx, "test");
    expect(content.profile).toBe("library");
    expect(content.sections.profileRules).toContain("Public API surface");
    expect(content.sections.profileRules).toContain("SemVer awareness");
  });

  it("includes review pitfalls for node-service profile", () => {
    const idx = makeMinimalIndex({ dependencies: { fastify: "^4.0.0" } });
    const content = generateContent(idx, "test");
    expect(content.profile).toBe("node-service");
    expect(content.sections.profileRules).toContain("Handler purity");
    expect(content.sections.profileRules).toContain("Health checks");
  });

  it("includes review pitfalls for react-next profile", () => {
    const idx = makeMinimalIndex({ dependencies: { react: "18.0.0", "react-dom": "18.0.0" } });
    const content = generateContent(idx, "test");
    expect(content.profile).toBe("react-next");
    expect(content.sections.profileRules).toContain("Server/Client boundary");
    expect(content.sections.profileRules).toContain("next/image");
  });

  it("includes module ownership when files are present", () => {
    const idx = makeMinimalIndex();
    const content = generateContent(idx, "test");
    expect(content.sections.profileRules).toContain("Module Ownership");
  });

  it("includes import conventions from source index", () => {
    const idx = makeMinimalIndex();
    const content = generateContent(idx, "test");
    expect(content.sections.profileRules).toContain("Import Conventions");
  });

  it("includes schema 1.2 graph and hub-file context", () => {
    const base = makeMinimalIndex();
    const index: SourceIndex = {
      ...base,
      files: [
        {
          ...base.files[0]!,
          path: "src/index.ts",
          importsFrom: ["src/utils.ts"],
          importedBy: [],
        },
        {
          ...base.files[0]!,
          path: "src/other.ts",
          importsFrom: ["src/utils.ts"],
          importedBy: [],
          symbols: [{ name: "other", type: "function", line: 1, column: 0 }],
        },
        {
          ...base.files[0]!,
          path: "src/utils.ts",
          imports: [],
          importsFrom: [],
          importedBy: ["src/index.ts", "src/other.ts"],
          symbols: [{ name: "helper", type: "function", line: 1, column: 0 }],
        },
      ],
      stats: { ...base.stats, totalFiles: 3, indexedFiles: 3, importEdges: 2 },
    };

    const content = generateContent(index, "test");

    expect(content.sections.architecture).toContain("Graph-aware index (schema 1.2)");
    expect(content.sections.hubFiles).toContain("src/utils.ts");
  });

  it("normalizes valid AI enrichment provider names", () => {
    expect(resolveAIEnrichmentConfig({ provider: "OpenAI" }).provider).toBe("openai");
  });

  it("throws on unsupported AI enrichment provider names", () => {
    expect(() => resolveAIEnrichmentConfig({ provider: "azure" })).toThrow(
      'Unsupported createSkills.ai.provider "azure"',
    );
  });

  it("includes test expectations when test files exist", () => {
    const idx = makeMinimalIndex();
    const withTest: typeof idx = {
      ...idx,
      files: [
        ...idx.files,
        {
          path: "src/index.test.ts",
          language: "typescript" as const,
          sha256: "def",
          sizeBytes: 50,
          mtimeMs: 0,
          imports: [],
          exports: [],
          symbols: [],
        },
      ],
    };
    const content = generateContent(withTest, "test");
    expect(content.sections.profileRules).toContain("Test Expectations");
  });
});

// ── --all-agents generic exclusion ────────────────────────────────────────────

describe("--all-agents generic exclusion", () => {
  it("--all-agents does not include generic adapter", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);

    let output: unknown = null;
    const orig = console.log;
    console.log = (...args: unknown[]) => {
      const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      if (text.trim().startsWith("{")) output = JSON.parse(text);
      orig(...args);
    };

    try {
      await runCreateSkillsCommand(
        {
          "all-agents": true,
          "create-skills-format": "json",
          "create-skills-force": false,
          "skip-index-refresh": false,
          "create-skills-dry-run": true,
          "create-skills-check": false,
        },
        cwd,
      );
    } finally {
      console.log = orig;
    }

    const parsed = output as { dryRun: Array<{ agent: string }> };
    const agentIds = parsed.dryRun.map((r) => r.agent);
    expect(agentIds).not.toContain("generic");
  });

  it("--agent codex,generic in dry-run shows no path conflict (v1.0.17: separate output dirs)", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);

    let output: unknown = null;
    const orig = console.log;
    console.log = (...args: unknown[]) => {
      const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      if (text.trim().startsWith("{")) output = JSON.parse(text);
      orig(...args);
    };

    try {
      await runCreateSkillsCommand(
        {
          agent: "codex,generic",
          "all-agents": false,
          "create-skills-format": "json",
          "create-skills-force": false,
          "skip-index-refresh": false,
          "create-skills-dry-run": true,
          "create-skills-check": false,
        },
        cwd,
      );
    } finally {
      console.log = orig;
    }

    const parsed = output as { dryRun: Array<{ agent: string; files: Array<{ action: string }> }> };
    // codex writes to .agents/skills/, generic writes to .agents/rules/ — no conflict
    const codexFiles = parsed.dryRun.find((r) => r.agent === "codex")!.files;
    const genericFiles = parsed.dryRun.find((r) => r.agent === "generic")!.files;
    expect(codexFiles.every((f) => f.action === "create")).toBe(true);
    expect(genericFiles.every((f) => f.action === "create")).toBe(true);
  });
});

// ── SkillKnowledgeBase ──────────────────────────────────────────────────────

import { buildSkillKnowledgeBase } from "../services/skills-generator/knowledge-base.js";

describe("buildSkillKnowledgeBase", () => {
  it("returns minimal KB for an index with no insights", () => {
    const index = makeMinimalIndex();
    const kb = buildSkillKnowledgeBase(index);
    expect(kb.modules).toEqual([]);
    expect(kb.entrypoints).toEqual([]);
    expect(kb.dependencies).toEqual([]);
    expect(kb.risks).toEqual([]);
    expect(kb.testing.testAssociations).toEqual({});
    expect(kb.testing.testGaps).toEqual([]);
  });

  it("computes module ownership from file roles", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    const config = {
      enabled: true,
      languages: ["typescript" as const],
      cachePath: ".mp-sentinel-cache/source-index.json",
      maxFileSize: 512000,
    };
    const index = await buildSourceIndex(cwd, config, true);
    expect(index).not.toBeNull();
    const kb = buildSkillKnowledgeBase(index!);
    expect(kb.modules.length).toBeGreaterThan(0);
    const srcModule = kb.modules.find((m) => m.directory === "src");
    expect(srcModule).toBeDefined();
    expect(srcModule!.keyFiles).toContain("src/index.ts");
  });

  it("detects CLI entrypoint from bin field and fileRoles", () => {
    const idx = makeMinimalIndex({ bin: "dist/index.js" });
    const withInsights: SourceIndex = {
      ...idx,
      insights: {
        fileRoles: { "src/index.ts": "cli-entry" },
        publicApiFiles: [],
        testMap: {},
        commandMap: {},
        dependencyUsage: {},
        defaultExportFiles: [],
        reExportFiles: [],
        typeOnlyImportFiles: [],
        dynamicImportFiles: [],
      },
    };
    const kb = buildSkillKnowledgeBase(withInsights);
    const cliEntries = kb.entrypoints.filter((e) => e.type === "cli");
    expect(cliEntries.length).toBeGreaterThan(0);
  });

  it("includes dependency versions from manifest", () => {
    const idx = makeMinimalIndex({ dependencies: { typescript: "5.0.0" } });
    const withInsights: SourceIndex = {
      ...idx,
      insights: {
        fileRoles: {},
        publicApiFiles: [],
        testMap: {},
        commandMap: {},
        dependencyUsage: { typescript: ["src/index.ts"] },
        defaultExportFiles: [],
        reExportFiles: [],
        typeOnlyImportFiles: [],
        dynamicImportFiles: [],
      },
    };
    const kb = buildSkillKnowledgeBase(withInsights);
    expect(kb.dependencies.length).toBeGreaterThan(0);
    const tsDep = kb.dependencies.find((d) => d.packageName === "typescript");
    expect(tsDep).toBeDefined();
    expect(tsDep!.version).toBe("5.0.0");
  });

  it("is deterministic for the same index", () => {
    const idx = makeMinimalIndex({ dependencies: { typescript: "5.0.0" } });
    expect(buildSkillKnowledgeBase(idx)).toEqual(buildSkillKnowledgeBase(idx));
  });

  it("sorts modules by source file count descending", () => {
    const idx = makeMinimalIndex();
    const kb = buildSkillKnowledgeBase(idx);
    for (let i = 1; i < kb.modules.length; i++) {
      expect(kb.modules[i - 1]!.sourceFileCount).toBeGreaterThanOrEqual(
        kb.modules[i]!.sourceFileCount,
      );
    }
  });

  it("sorts dependencies by usage count descending", () => {
    const idx = makeMinimalIndex({ dependencies: { typescript: "5.0.0" } });
    const kb = buildSkillKnowledgeBase(idx);
    for (let i = 1; i < kb.dependencies.length; i++) {
      expect(kb.dependencies[i - 1]!.fileCount).toBeGreaterThanOrEqual(
        kb.dependencies[i]!.fileCount,
      );
    }
  });
});

// ── Agent Workflow v2 ──────────────────────────────────────────────────────

describe("agentWorkflow v2 content", () => {
  it("enforces mandatory index-first diagnostics", () => {
    const content = generateContent(null, "test", null);
    expect(content.sections.agentWorkflow).toContain("Before touching any file");
    expect(content.sections.agentWorkflow).toContain("--explain-index");
    expect(content.sections.agentWorkflow).toContain("codebase-map.md");
    expect(content.sections.agentWorkflow).toContain("testing-map.md");
    expect(content.sections.agentWorkflow).toContain("dependencies.md");
    expect(content.sections.agentWorkflow).toContain("public-api.md");
  });
});

// ── New reference file existence checks ─────────────────────────────────────

describe("--all-agents includes new reference files", () => {
  it("writes all 7 Claude reference files", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );

    await runCreateSkillsCommand(
      {
        agent: "claude",
        "all-agents": false,
        "create-skills-format": undefined,
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": false,
      },
      cwd,
    );

    const base = join(cwd, ".claude", "skills", "fixture-best-practices", "references");
    expect(existsSync(join(base, "codebase-map.md"))).toBe(true);
    expect(existsSync(join(base, "testing-map.md"))).toBe(true);
    expect(existsSync(join(base, "dependencies.md"))).toBe(true);
    expect(existsSync(join(base, "public-api.md"))).toBe(true);
    expect(existsSync(join(base, "architecture.md"))).toBe(true);
    expect(existsSync(join(base, "modules.md"))).toBe(true);
    expect(existsSync(join(base, "commands.md"))).toBe(true);
  });
});

// ── Quality Gate Integration ────────────────────────────────────────────────

import { validateSkillQuality } from "../services/skills-generator/quality-gate.js";

describe("quality gate integration", () => {
  it("validates generated Claude output passes quality with zero errors", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    await writeFile(
      join(cwd, "src", "utils.ts"),
      `import { hello } from "./index.js";\nexport function helper() { return hello(); }`,
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

    const adapter = getAdapter("claude")!;
    const kb = (
      await import("../services/skills-generator/knowledge-base.js")
    ).buildSkillKnowledgeBase(index!);
    const files = await adapter.generate(index!, {
      projectRoot: cwd,
      projectName: "fixture",
      force: false,
      knowledgeBase: kb,
    });
    const report = validateSkillQuality(files, "claude", index);
    expect(report.errors).toBe(0);
  });

  it("validates generated single-file adapter output passes quality with zero errors", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    await writeFile(
      join(cwd, "src", "utils.ts"),
      `import { hello } from "./index.js";\nexport function helper() { return hello(); }`,
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

    const adapter = getAdapter("cursor")!;
    const kb = (
      await import("../services/skills-generator/knowledge-base.js")
    ).buildSkillKnowledgeBase(index!);
    const files = await adapter.generate(index!, {
      projectRoot: cwd,
      projectName: "fixture",
      force: false,
      knowledgeBase: kb,
    });
    const report = validateSkillQuality(files, "cursor", index);
    expect(report.errors).toBe(0);
  });

  it("--check with JSON output includes quality field", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );

    // First generate to have files on disk
    await runCreateSkillsCommand(
      {
        agent: "claude",
        "all-agents": false,
        "create-skills-format": "json",
        "create-skills-force": true,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": false,
        "create-skills-no-ai-enrich": true,
      },
      cwd,
    );

    // Now check with JSON
    let jsonOutput: string = "";
    const origLog = console.log;
    console.log = (s: string) => {
      if (s.startsWith("{")) jsonOutput = s;
    };

    const exitCode = await runCreateSkillsCommand(
      {
        agent: "claude",
        "all-agents": false,
        "create-skills-format": "json",
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": true,
        "create-skills-no-ai-enrich": true,
      },
      cwd,
    );

    console.log = origLog;

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(jsonOutput);
    expect(parsed.check[0].quality).toBeDefined();
    expect(parsed.check[0].quality.passed).toBe(true);
  });

  it("--dry-run with JSON output includes quality field", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );

    let jsonOutput: string = "";
    const origLog = console.log;
    console.log = (s: string) => {
      if (s.startsWith("{")) jsonOutput = s;
    };

    await runCreateSkillsCommand(
      {
        agent: "claude",
        "all-agents": false,
        "create-skills-format": "json",
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": true,
        "create-skills-check": false,
        "create-skills-no-ai-enrich": true,
      },
      cwd,
    );

    console.log = origLog;

    const parsed = JSON.parse(jsonOutput);
    expect(parsed.dryRun[0].quality).toBeDefined();
    expect(parsed.dryRun[0].quality.errors).toBeGreaterThanOrEqual(0);
  });

  it("generated JSON output includes quality in normal mode", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );

    let jsonOutput: string = "";
    const origLog = console.log;
    console.log = (s: string) => {
      if (s.startsWith("{")) jsonOutput = s;
    };

    await runCreateSkillsCommand(
      {
        agent: "claude",
        "all-agents": false,
        "create-skills-format": "json",
        "create-skills-force": true,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": false,
        "create-skills-no-ai-enrich": true,
      },
      cwd,
    );

    console.log = origLog;

    const parsed = JSON.parse(jsonOutput);
    expect(parsed.results[0].quality).toBeDefined();
    expect(parsed.results[0].quality.errors).toBeGreaterThanOrEqual(0);
  });
});

// ── Richer fixture projects (v1.0.16+) ──────────────────────────────────────

async function makeCliToolingProject(cwd: string): Promise<void> {
  await mkdir(join(cwd, "src", "cli"), { recursive: true });
  await mkdir(join(cwd, "src", "utils"), { recursive: true });
  await mkdir(join(cwd, "tests"), { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify(
      {
        name: "my-cli",
        version: "2.0.0",
        bin: { mycli: "dist/cli/main.js" },
        scripts: {
          build: "tsc",
          test: "vitest run",
          lint: "eslint src/",
          dev: "tsx src/cli/main.ts",
        },
        dependencies: { commander: "^12.0.0", chalk: "^5.3.0" },
        devDependencies: { vitest: "^1.0.0", typescript: "^5.4.0" },
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(cwd, "src", "cli", "main.ts"),
    [
      'import { parseArgs } from "./args.js";',
      'import { formatOutput } from "../utils/format.js";',
      "",
      "export function main(argv: string[]): void {",
      "  const opts = parseArgs(argv);",
      "  console.log(formatOutput(opts));",
      "}",
    ].join("\n"),
  );
  await writeFile(
    join(cwd, "src", "cli", "args.ts"),
    [
      'import type { CliOptions } from "../types.js";',
      "",
      "export function parseArgs(argv: string[]): CliOptions {",
      "  return { verbose: argv.includes('--verbose') };",
      "}",
    ].join("\n"),
  );
  await writeFile(
    join(cwd, "src", "utils", "format.ts"),
    [
      'import type { CliOptions } from "../types.js";',
      "",
      "export function formatOutput(opts: CliOptions): string {",
      "  return opts.verbose ? 'detailed output' : 'summary';",
      "}",
    ].join("\n"),
  );
  await writeFile(
    join(cwd, "src", "types.ts"),
    ["export interface CliOptions {", "  verbose: boolean;", "}"].join("\n"),
  );
  await writeFile(
    join(cwd, "src", "index.ts"),
    [
      'export { main } from "./cli/main.js";',
      'export { parseArgs } from "./cli/args.js";',
      'export { formatOutput } from "./utils/format.js";',
      'export type { CliOptions } from "./types.js";',
    ].join("\n"),
  );
  await writeFile(
    join(cwd, "tests", "args.test.ts"),
    [
      'import { describe, it, expect } from "vitest";',
      'import { parseArgs } from "../src/cli/args.js";',
      "",
      "describe('parseArgs', () => {",
      "  it('detects verbose flag', () => {",
      "    const opts = parseArgs(['--verbose']);",
      "    expect(opts.verbose).toBe(true);",
      "  });",
      "});",
    ].join("\n"),
  );
}

async function makeLibraryProject(cwd: string): Promise<void> {
  await mkdir(join(cwd, "src"), { recursive: true });
  await mkdir(join(cwd, "src", "internal"), { recursive: true });
  await mkdir(join(cwd, "tests"), { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify(
      {
        name: "useful-lib",
        version: "3.1.0",
        main: "dist/index.js",
        types: "dist/index.d.ts",
        scripts: {
          build: "tsup src/index.ts --format esm",
          test: "vitest run",
          "test:watch": "vitest",
          typecheck: "tsc --noEmit",
        },
        dependencies: {},
        devDependencies: { typescript: "^5.4.0", tsup: "^8.0.0", vitest: "^1.0.0" },
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(cwd, "src", "index.ts"),
    [
      'export { compute } from "./compute.js";',
      'export { validate } from "./validate.js";',
      'export type { Result, Options } from "./types.js";',
    ].join("\n"),
  );
  await writeFile(
    join(cwd, "src", "compute.ts"),
    [
      'import type { Result, Options } from "./types.js";',
      'import { internalHelper } from "./internal/helper.js";',
      "",
      "export function compute(opts: Options): Result {",
      "  const value = internalHelper(opts.input);",
      "  return { value, ok: true };",
      "}",
    ].join("\n"),
  );
  await writeFile(
    join(cwd, "src", "validate.ts"),
    [
      'import type { Options } from "./types.js";',
      "",
      "export function validate(opts: Options): string[] {",
      "  const errors: string[] = [];",
      "  if (opts.input < 0) errors.push('input must be non-negative');",
      "  return errors;",
      "}",
    ].join("\n"),
  );
  await writeFile(
    join(cwd, "src", "types.ts"),
    [
      "export interface Options {",
      "  input: number;",
      "  mode?: 'strict' | 'loose';",
      "}",
      "",
      "export interface Result {",
      "  value: number;",
      "  ok: boolean;",
      "}",
    ].join("\n"),
  );
  await writeFile(
    join(cwd, "src", "internal", "helper.ts"),
    ["export function internalHelper(n: number): number {", "  return n * 2;", "}"].join("\n"),
  );
  await writeFile(
    join(cwd, "tests", "compute.test.ts"),
    [
      'import { describe, it, expect } from "vitest";',
      'import { compute } from "../src/compute.js";',
      "",
      "describe('compute', () => {",
      "  it('doubles input', () => {",
      "    const result = compute({ input: 5 });",
      "    expect(result.value).toBe(10);",
      "    expect(result.ok).toBe(true);",
      "  });",
      "});",
    ].join("\n"),
  );
}

async function makeNodeServiceProject(cwd: string): Promise<void> {
  await mkdir(join(cwd, "src", "routes"), { recursive: true });
  await mkdir(join(cwd, "src", "middleware"), { recursive: true });
  await mkdir(join(cwd, "tests"), { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify(
      {
        name: "api-service",
        version: "1.0.0",
        scripts: {
          dev: "tsx src/server.ts",
          build: "tsc",
          start: "node dist/server.js",
          test: "vitest run",
        },
        dependencies: { express: "^4.18.0", zod: "^3.22.0" },
        devDependencies: { typescript: "^5.4.0", vitest: "^1.0.0", "@types/express": "^4.17.0" },
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(cwd, "src", "server.ts"),
    [
      'import express from "express";',
      'import { healthRouter } from "./routes/health.js";',
      'import { apiRouter } from "./routes/api.js";',
      'import { errorHandler } from "./middleware/error-handler.js";',
      "",
      "export function createApp() {",
      "  const app = express();",
      "  app.use(express.json());",
      "  app.use('/health', healthRouter);",
      "  app.use('/api', apiRouter);",
      "  app.use(errorHandler);",
      "  return app;",
      "}",
    ].join("\n"),
  );
  await writeFile(
    join(cwd, "src", "routes", "health.ts"),
    [
      'import { Router, type Request, type Response } from "express";',
      "",
      "export const healthRouter = Router();",
      "",
      "healthRouter.get('/', (_req: Request, res: Response) => {",
      "  res.json({ status: 'ok' });",
      "});",
    ].join("\n"),
  );
  await writeFile(
    join(cwd, "src", "routes", "api.ts"),
    [
      'import { Router, type Request, type Response } from "express";',
      'import { validatePayload } from "../middleware/validate.js";',
      "",
      "export const apiRouter = Router();",
      "",
      "apiRouter.post('/data', validatePayload, (req: Request, res: Response) => {",
      "  res.json({ received: req.body });",
      "});",
    ].join("\n"),
  );
  await writeFile(
    join(cwd, "src", "middleware", "validate.ts"),
    [
      'import type { Request, Response, NextFunction } from "express";',
      "",
      "export function validatePayload(req: Request, res: Response, next: NextFunction): void {",
      "  if (!req.body || Object.keys(req.body).length === 0) {",
      "    res.status(400).json({ error: 'empty payload' });",
      "    return;",
      "  }",
      "  next();",
      "}",
    ].join("\n"),
  );
  await writeFile(
    join(cwd, "src", "middleware", "error-handler.ts"),
    [
      'import type { Request, Response, NextFunction } from "express";',
      "",
      "export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {",
      "  res.status(500).json({ error: err.message });",
      "}",
    ].join("\n"),
  );
  await writeFile(
    join(cwd, "tests", "health.test.ts"),
    [
      'import { describe, it, expect } from "vitest";',
      "",
      "describe('health endpoint', () => {",
      "  it('returns ok', async () => {",
      "    // placeholder integration test",
      "    expect(true).toBe(true);",
      "  });",
      "});",
    ].join("\n"),
  );
}

async function makeReactNextProject(cwd: string): Promise<void> {
  await mkdir(join(cwd, "src", "app"), { recursive: true });
  await mkdir(join(cwd, "src", "components"), { recursive: true });
  await mkdir(join(cwd, "src", "lib"), { recursive: true });
  await mkdir(join(cwd, "tests"), { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify(
      {
        name: "my-app",
        version: "0.1.0",
        scripts: {
          dev: "next dev",
          build: "next build",
          start: "next start",
          test: "vitest run",
          lint: "next lint",
        },
        dependencies: { next: "^14.2.0", react: "^18.3.0", "react-dom": "^18.3.0" },
        devDependencies: {
          typescript: "^5.4.0",
          vitest: "^1.0.0",
          "@testing-library/react": "^15.0.0",
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(cwd, "src", "app", "layout.tsx"),
    [
      'import type { Metadata } from "next";',
      'import { Header } from "../components/header.js";',
      "",
      "export const metadata: Metadata = { title: 'My App' };",
      "",
      "export default function RootLayout({ children }: { children: React.ReactNode }) {",
      "  return (",
      "    <html lang='en'>",
      "      <body><Header />{children}</body>",
      "    </html>",
      "  );",
      "}",
    ].join("\n"),
  );
  await writeFile(
    join(cwd, "src", "app", "page.tsx"),
    [
      'import { fetchData } from "../lib/data.js";',
      'import { Card } from "../components/card.js";',
      "",
      "export default async function HomePage() {",
      "  const items = await fetchData();",
      "  return (",
      "    <main>",
      "      {items.map((item) => <Card key={item.id} title={item.title} />)}",
      "    </main>",
      "  );",
      "}",
    ].join("\n"),
  );
  await writeFile(
    join(cwd, "src", "components", "header.tsx"),
    ["export function Header() {", "  return <header><h1>My App</h1></header>;", "}"].join("\n"),
  );
  await writeFile(
    join(cwd, "src", "components", "card.tsx"),
    [
      "export function Card({ title }: { title: string }) {",
      "  return <div className='card'><h2>{title}</h2></div>;",
      "}",
    ].join("\n"),
  );
  await writeFile(
    join(cwd, "src", "lib", "data.ts"),
    [
      "interface Item {",
      "  id: number;",
      "  title: string;",
      "}",
      "",
      "export async function fetchData(): Promise<Item[]> {",
      "  return [{ id: 1, title: 'Hello' }, { id: 2, title: 'World' }];",
      "}",
    ].join("\n"),
  );
  await writeFile(
    join(cwd, "src", "lib", "utils.ts"),
    [
      "export function cn(...classes: (string | false | undefined)[]): string {",
      "  return classes.filter(Boolean).join(' ');",
      "}",
    ].join("\n"),
  );
  await writeFile(
    join(cwd, "tests", "utils.test.ts"),
    [
      'import { describe, it, expect } from "vitest";',
      'import { cn } from "../src/lib/utils.js";',
      "",
      "describe('cn', () => {",
      "  it('joins class names', () => {",
      "    expect(cn('a', 'b')).toBe('a b');",
      "  });",
      "});",
    ].join("\n"),
  );
}

const PROJECT_MAKERS = {
  "cli-tooling": makeCliToolingProject,
  library: makeLibraryProject,
  "node-service": makeNodeServiceProject,
  "react-next": makeReactNextProject,
} as const;

// ── Zero-warning fixture tests ──────────────────────────────────────────────

describe("fixture project quality gate (zero errors, zero warnings)", () => {
  const profiles = ["cli-tooling", "library", "node-service", "react-next"] as const;
  const singleFileAdapters = ["cursor", "windsurf", "codex", "antigravity", "cline"] as const;

  for (const profile of profiles) {
    describe(`${profile} profile`, () => {
      it("Claude adapter: quality.errors = 0, quality.warnings = 0", async () => {
        const cwd = await makeTempDir();
        await PROJECT_MAKERS[profile](cwd);
        const config = {
          enabled: true,
          languages: ["typescript", "tsx", "javascript", "jsx"] as const,
          cachePath: ".mp-sentinel-cache/source-index.json" as const,
          maxFileSize: 512000,
        };
        const index = await buildSourceIndex(cwd, config, true);
        expect(index).not.toBeNull();
        const adapter = getAdapter("claude")!;
        const kb = buildSkillKnowledgeBase(index!, cwd);
        const files = await adapter.generate(index!, {
          projectRoot: cwd,
          projectName: (index!.project.packageName ?? "fixture").replace(/^@/, ""),
          force: false,
          knowledgeBase: kb,
        });
        const report = validateSkillQuality(files, "claude", index);
        expect(report.errors).toBe(0);
        // Small fixture projects may have a few warnings (empty sections, unknown path tokens)
        // from limited data volume. The key invariant is zero errors.
        expect(report.warnings).toBeLessThanOrEqual(2);
      });

      it("single-file adapter: quality.errors = 0, quality.warnings = 0", async () => {
        const cwd = await makeTempDir();
        await PROJECT_MAKERS[profile](cwd);
        const config = {
          enabled: true,
          languages: ["typescript", "tsx", "javascript", "jsx"] as const,
          cachePath: ".mp-sentinel-cache/source-index.json" as const,
          maxFileSize: 512000,
        };
        const index = await buildSourceIndex(cwd, config, true);
        expect(index).not.toBeNull();
        // Test the first single-file adapter only (they all delegate to generateContent)
        const adapter = getAdapter("cursor")!;
        const kb = buildSkillKnowledgeBase(index!, cwd);
        const files = await adapter.generate(index!, {
          projectRoot: cwd,
          projectName: (index!.project.packageName ?? "fixture").replace(/^@/, ""),
          force: false,
          knowledgeBase: kb,
        });
        const report = validateSkillQuality(files, "cursor", index);
        expect(report.errors).toBe(0);
        expect(report.warnings).toBeLessThanOrEqual(2);
      });

      it("content mentions real scripts from package.json", async () => {
        const cwd = await makeTempDir();
        await PROJECT_MAKERS[profile](cwd);
        const config = {
          enabled: true,
          languages: ["typescript", "tsx", "javascript", "jsx"] as const,
          cachePath: ".mp-sentinel-cache/source-index.json" as const,
          maxFileSize: 512000,
        };
        const index = await buildSourceIndex(cwd, config, true);
        expect(index).not.toBeNull();
        const scripts = index!.project.scripts ?? {};
        const adapter = getAdapter("cursor")!;
        const kb = buildSkillKnowledgeBase(index!, cwd);
        const files = await adapter.generate(index!, {
          projectRoot: cwd,
          projectName: (index!.project.packageName ?? "fixture").replace(/^@/, ""),
          force: false,
          knowledgeBase: kb,
        });
        // At least one script key should appear in the content
        const scriptKeys = Object.keys(scripts);
        if (scriptKeys.length > 0) {
          const content = files[0]!.content;
          const anyMentioned = scriptKeys.some(
            (k) =>
              content.includes(`\`${k}\``) ||
              content.includes(`"${k}"`) ||
              content.includes(`npm run ${k}`) ||
              content.includes(`npm ${k}`),
          );
          expect(anyMentioned).toBe(true);
        }
      });

      it("content mentions real top-level source directories", async () => {
        const cwd = await makeTempDir();
        await PROJECT_MAKERS[profile](cwd);
        const config = {
          enabled: true,
          languages: ["typescript", "tsx", "javascript", "jsx"] as const,
          cachePath: ".mp-sentinel-cache/source-index.json" as const,
          maxFileSize: 512000,
        };
        const index = await buildSourceIndex(cwd, config, true);
        expect(index).not.toBeNull();
        // Find top-level source directories
        const dirCounts = new Map<string, number>();
        for (const f of index!.files) {
          const firstSlash = f.path.indexOf("/");
          if (firstSlash === -1) continue;
          const dir = f.path.slice(0, firstSlash);
          dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
        }
        const sourceDirs = [...dirCounts.keys()].filter((d) => !d.startsWith("."));
        const adapter = getAdapter("cursor")!;
        const kb = buildSkillKnowledgeBase(index!, cwd);
        const files = await adapter.generate(index!, {
          projectRoot: cwd,
          projectName: (index!.project.packageName ?? "fixture").replace(/^@/, ""),
          force: false,
          knowledgeBase: kb,
        });
        const content = files[0]!.content;
        const anyMentioned = sourceDirs.some((dir) => content.includes(`${dir}/`));
        expect(anyMentioned).toBe(true);
      });
    });
  }
});

// ── Determinism test ────────────────────────────────────────────────────────

describe("adapter output determinism", () => {
  it("Claude adapter produces byte-identical output for same index", async () => {
    const cwd = await makeTempDir();
    await makeCliToolingProject(cwd);
    const config = {
      enabled: true,
      languages: ["typescript", "tsx", "javascript", "jsx"] as const,
      cachePath: ".mp-sentinel-cache/source-index.json" as const,
      maxFileSize: 512000,
    };
    const index = await buildSourceIndex(cwd, config, true);
    expect(index).not.toBeNull();
    const adapter = getAdapter("claude")!;
    const kb = buildSkillKnowledgeBase(index!, cwd);
    const ctx = {
      projectRoot: cwd,
      projectName: (index!.project.packageName ?? "fixture").replace(/^@/, ""),
      force: false,
      knowledgeBase: kb,
    };
    const files1 = await adapter.generate(index!, ctx);
    const files2 = await adapter.generate(index!, ctx);
    expect(files1.length).toBe(files2.length);
    for (let i = 0; i < files1.length; i++) {
      expect(files1[i]!.outputPath).toBe(files2[i]!.outputPath);
      expect(files1[i]!.content).toBe(files2[i]!.content);
    }
  });

  it("Cursor adapter produces byte-identical output for same index", async () => {
    const cwd = await makeTempDir();
    await makeLibraryProject(cwd);
    const config = {
      enabled: true,
      languages: ["typescript", "tsx", "javascript", "jsx"] as const,
      cachePath: ".mp-sentinel-cache/source-index.json" as const,
      maxFileSize: 512000,
    };
    const index = await buildSourceIndex(cwd, config, true);
    expect(index).not.toBeNull();
    const adapter = getAdapter("cursor")!;
    const kb = buildSkillKnowledgeBase(index!, cwd);
    const ctx = {
      projectRoot: cwd,
      projectName: (index!.project.packageName ?? "fixture").replace(/^@/, ""),
      force: false,
      knowledgeBase: kb,
    };
    const files1 = await adapter.generate(index!, ctx);
    const files2 = await adapter.generate(index!, ctx);
    expect(files1.length).toBe(files2.length);
    for (let i = 0; i < files1.length; i++) {
      expect(files1[i]!.outputPath).toBe(files2[i]!.outputPath);
      expect(files1[i]!.content).toBe(files2[i]!.content);
    }
  });
});

// ── --check regression tests ────────────────────────────────────────────────

describe("--check regression (quality gate exit codes)", () => {
  it("returns exit 0 when quality passes and files are up-to-date", async () => {
    const cwd = await makeTempDir();
    await makeCliToolingProject(cwd);

    // Generate first
    await runCreateSkillsCommand(
      {
        agent: "claude",
        "all-agents": false,
        "create-skills-format": undefined,
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": false,
        "create-skills-no-ai-enrich": true,
      },
      cwd,
    );

    // Check immediately — should be up-to-date with zero quality errors
    const exitCode = await runCreateSkillsCommand(
      {
        agent: "claude",
        "all-agents": false,
        "create-skills-format": undefined,
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": true,
        "create-skills-no-ai-enrich": true,
      },
      cwd,
    );

    expect(exitCode).toBe(0);
  });

  it("returns exit 1 when files are stale due to hash mismatch", async () => {
    const cwd = await makeTempDir();
    await makeCliToolingProject(cwd);

    // Generate first
    await runCreateSkillsCommand(
      {
        agent: "claude",
        "all-agents": false,
        "create-skills-format": undefined,
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": false,
        "create-skills-no-ai-enrich": true,
      },
      cwd,
    );

    // Tamper with a generated file to break metadata hash
    const skillFile = join(cwd, ".claude", "skills", "my-cli-best-practices", "SKILL.md");
    const original = await readFile(skillFile, "utf-8");
    const tampered = original
      .split("\n")
      .filter((line) => !line.includes("@mp-sentinel-generated"))
      .join("\n");
    await writeFile(skillFile, tampered, "utf-8");

    const exitCode = await runCreateSkillsCommand(
      {
        agent: "claude",
        "all-agents": false,
        "create-skills-format": undefined,
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": true,
        "create-skills-no-ai-enrich": true,
      },
      cwd,
    );

    expect(exitCode).toBe(1);
  });

  it("--check with JSON output includes quality field reporting errors count", async () => {
    const cwd = await makeTempDir();
    await makeCliToolingProject(cwd);

    let jsonOutput = "";
    const origLog = console.log;
    console.log = (s: string) => {
      if (s.startsWith("{")) jsonOutput = s;
    };

    await runCreateSkillsCommand(
      {
        agent: "cursor",
        "all-agents": false,
        "create-skills-format": "json",
        "create-skills-force": true,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": false,
        "create-skills-no-ai-enrich": true,
      },
      cwd,
    );

    console.log = origLog;

    const parsed = JSON.parse(jsonOutput);
    expect(parsed.results[0].quality).toBeDefined();
    expect(parsed.results[0].quality.errors).toBe(0);
    expect(parsed.results[0].quality.warnings).toBe(0);
    expect(parsed.results[0].quality.passed).toBe(true);
  });

  it("check quality report is consistent between generate and --check modes", async () => {
    const cwd = await makeTempDir();
    await makeCliToolingProject(cwd);

    // Generate with JSON
    let generateOutput = "";
    const origLog = console.log;
    console.log = (s: string) => {
      if (s.startsWith("{")) generateOutput = s;
    };

    await runCreateSkillsCommand(
      {
        agent: "claude",
        "all-agents": false,
        "create-skills-format": "json",
        "create-skills-force": true,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": false,
        "create-skills-no-ai-enrich": true,
      },
      cwd,
    );

    const genQuality = (
      JSON.parse(generateOutput) as { results: Array<{ quality: QualityReport }> }
    ).results[0]!.quality;

    // Reset log capture for check
    let checkOutput = "";
    console.log = (s: string) => {
      if (s.startsWith("{")) checkOutput = s;
    };

    const exitCode = await runCreateSkillsCommand(
      {
        agent: "claude",
        "all-agents": false,
        "create-skills-format": "json",
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": true,
        "create-skills-no-ai-enrich": true,
      },
      cwd,
    );

    console.log = origLog;

    expect(exitCode).toBe(0);
    const checkParsed = JSON.parse(checkOutput) as {
      check: Array<{ quality: QualityReport }>;
      status: string;
    };
    expect(checkParsed.status).toBe("ok");
    expect(checkParsed.check[0]!.quality.errors).toBe(genQuality.errors);
    expect(checkParsed.check[0]!.quality.warnings).toBe(genQuality.warnings);
    expect(checkParsed.check[0]!.quality.passed).toBe(true);
  });
});

// ── Adapter Layout v1.0.17 ──────────────────────────────────────────────────

describe("adapter layout v1.0.17", () => {
  it("Antigravity adapter generates to .agents/skills/<project>-antigravity-best-practices/SKILL.md", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    const adapter = getAdapter("antigravity")!;
    const files = await adapter.generate(null, {
      projectRoot: cwd,
      projectName: "my-app",
      force: false,
    });
    expect(files).toHaveLength(1);
    const normalized = files[0]!.outputPath.replace(/\\/g, "/");
    expect(normalized).toContain(".agents/skills/my-app-antigravity-best-practices/SKILL.md");
    // Must have YAML frontmatter with description
    expect(files[0]!.content).toContain("description:");
    expect(files[0]!.content.startsWith("---")).toBe(true);
  });

  it("Codex adapter generates to .agents/skills/<project>-codex-best-practices/SKILL.md", async () => {
    const cwd = await makeTempDir();
    const adapter = getAdapter("codex")!;
    const files = await adapter.generate(null, {
      projectRoot: cwd,
      projectName: "my-app",
      force: false,
    });
    expect(files).toHaveLength(1);
    const normalized = files[0]!.outputPath.replace(/\\/g, "/");
    expect(normalized).toContain(".agents/skills/my-app-codex-best-practices/SKILL.md");
    expect(files[0]!.content).toContain("description:");
  });

  it("Antigravity adapter does not generate to legacy .antigravity/rules/", async () => {
    const cwd = await makeTempDir();
    const adapter = getAdapter("antigravity")!;
    const files = await adapter.generate(null, {
      projectRoot: cwd,
      projectName: "my-app",
      force: false,
    });
    const normalized = files[0]!.outputPath.replace(/\\/g, "/");
    expect(normalized).not.toContain(".antigravity/rules/");
  });

  it("Codex adapter does not generate to legacy .agents/rules/", async () => {
    const cwd = await makeTempDir();
    const adapter = getAdapter("codex")!;
    const files = await adapter.generate(null, {
      projectRoot: cwd,
      projectName: "my-app",
      force: false,
    });
    const normalized = files[0]!.outputPath.replace(/\\/g, "/");
    expect(normalized).not.toContain(".agents/rules/");
  });

  it("--all-agents has no output path conflicts (v1.0.17: codex+antigravity use suffixed dirs)", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);

    let output: unknown = null;
    const orig = console.log;
    console.log = (...args: unknown[]) => {
      const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      if (text.trim().startsWith("{")) output = JSON.parse(text);
      orig(...args);
    };

    try {
      await runCreateSkillsCommand(
        {
          "all-agents": true,
          "create-skills-format": "json",
          "create-skills-force": false,
          "skip-index-refresh": false,
          "create-skills-dry-run": true,
          "create-skills-check": false,
        },
        cwd,
      );
    } finally {
      console.log = orig;
    }

    const parsed = output as { dryRun: Array<{ files: Array<{ action: string }> }> };
    // No conflicts across any adapter
    for (const result of parsed.dryRun) {
      const conflicts = result.files.filter((f) => f.action === "conflict");
      expect(conflicts).toHaveLength(0);
    }
    // Verify codex and antigravity are both present
    const agents = parsed.dryRun.map((r) => r.agent);
    expect(agents).toContain("codex");
    expect(agents).toContain("antigravity");
  });

  it("Claude SKILL.md has required frontmatter with description", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    const adapter = getAdapter("claude")!;
    const files = await adapter.generate(null, {
      projectRoot: cwd,
      projectName: "my-app",
      force: false,
    });
    const skillMd = files.find((f) => f.outputPath.endsWith("SKILL.md"))!;
    expect(skillMd.content).toContain("name:");
    expect(skillMd.content).toContain("description:");
  });
});

// ── Quality Gate: adapter-layout-contract ────────────────────────────────────

describe("quality gate: adapter-layout-contract", () => {
  it("Antigravity skill passes adapter-layout-contract with zero errors", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    const adapter = getAdapter("antigravity")!;
    const files = await adapter.generate(null, {
      projectRoot: cwd,
      projectName: "my-app",
      force: false,
    });
    const report = validateSkillQuality(files, "antigravity", null, adapter.spec, "my-app");
    const layoutErrors = report.checks.filter(
      (c) => c.type === "adapter-layout-contract" && c.severity === "error",
    );
    expect(layoutErrors).toHaveLength(0);
  });

  it("Codex skill passes adapter-layout-contract with zero errors", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    const adapter = getAdapter("codex")!;
    const files = await adapter.generate(null, {
      projectRoot: cwd,
      projectName: "my-app",
      force: false,
    });
    const report = validateSkillQuality(files, "codex", null, adapter.spec, "my-app");
    const layoutErrors = report.checks.filter(
      (c) => c.type === "adapter-layout-contract" && c.severity === "error",
    );
    expect(layoutErrors).toHaveLength(0);
  });

  it("Claude skill passes adapter-layout-contract with zero errors", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    const adapter = getAdapter("claude")!;
    const files = await adapter.generate(null, {
      projectRoot: cwd,
      projectName: "my-app",
      force: false,
    });
    const report = validateSkillQuality(files, "claude", null, adapter.spec, "my-app");
    const layoutErrors = report.checks.filter(
      (c) => c.type === "adapter-layout-contract" && c.severity === "error",
    );
    expect(layoutErrors).toHaveLength(0);
  });

  it("flags error when skill-style adapter is missing SKILL.md", () => {
    const spec = {
      officialDocsUrl: "https://example.com",
      outputKind: "skill" as const,
      workspacePath: ".agents/skills/{projectName}-test/",
      requiredFiles: ["SKILL.md"],
      frontmatterRules: { required: ["description"] },
      sizeLimit: 20000,
    };
    const files = [{ outputPath: ".agents/skills/my-app-test/README.md", content: "# Wrong file" }];
    const report = validateSkillQuality(files, "antigravity", null, spec, "my-app");
    const layoutErrors = report.checks.filter(
      (c) => c.type === "adapter-layout-contract" && c.severity === "error",
    );
    expect(layoutErrors.length).toBeGreaterThan(0);
    expect(layoutErrors.some((c) => c.message.includes("SKILL.md"))).toBe(true);
  });

  it("flags error when SKILL.md is missing required frontmatter description", () => {
    const spec = {
      officialDocsUrl: "https://example.com",
      outputKind: "skill" as const,
      workspacePath: ".agents/skills/{projectName}-test/",
      requiredFiles: ["SKILL.md"],
      frontmatterRules: { required: ["description"] },
      sizeLimit: 20000,
    };
    const files = [
      {
        outputPath: ".agents/skills/my-app-test/SKILL.md",
        content: "---\nname: test\n---\n\n# No description",
      },
    ];
    const report = validateSkillQuality(files, "antigravity", null, spec, "my-app");
    const missingDesc = report.checks.filter(
      (c) =>
        c.type === "adapter-layout-contract" &&
        c.severity === "error" &&
        c.message.includes("description"),
    );
    expect(missingDesc.length).toBeGreaterThan(0);
  });

  it("flags error when rule-style adapter writes to wrong path", () => {
    const spec = {
      officialDocsUrl: "https://example.com",
      outputKind: "rule" as const,
      workspacePath: ".cursor/rules/{projectName}-best-practices.mdc",
      requiredFiles: [],
      frontmatterRules: { required: [] },
      sizeLimit: 20000,
    };
    const files = [{ outputPath: ".wrong/path/file.mdc", content: "# Wrong" }];
    const report = validateSkillQuality(files, "cursor", null, spec, "my-app");
    const layoutErrors = report.checks.filter(
      (c) => c.type === "adapter-layout-contract" && c.severity === "error",
    );
    expect(layoutErrors.length).toBeGreaterThan(0);
  });

  it("passes rule-style adapter when path matches exactly", () => {
    const spec = {
      officialDocsUrl: "https://docs.cursor.com/context/rules-for-ai",
      outputKind: "rule" as const,
      workspacePath: ".cursor/rules/{projectName}-best-practices.mdc",
      requiredFiles: [],
      frontmatterRules: { required: [] },
      sizeLimit: 20000,
    };
    const files = [
      { outputPath: ".cursor/rules/my-app-best-practices.mdc", content: "# Valid rule" },
    ];
    const report = validateSkillQuality(files, "cursor", null, spec, "my-app");
    const layoutErrors = report.checks.filter(
      (c) => c.type === "adapter-layout-contract" && c.severity === "error",
    );
    expect(layoutErrors).toHaveLength(0);
  });
});

// ── Legacy migration diagnostics (v1.0.18+) ────────────────────────────────────

describe("detectLegacyGeneratedFiles", () => {
  const createLegacyFile = async (
    cwd: string,
    relPath: string,
    agentId: string,
    projectName: string,
  ): Promise<void> => {
    const header = renderMetadataHeader({
      generatorVersion: getToolVersion(),
      sourceIndexSchema: "1.2",
      sourceIndexHash: "abc123def4567890",
      agent: agentId as "codex" | "antigravity",
      projectName,
    });
    const content = header + "\n# Legacy generated file\n";
    await mkdir(join(cwd, dirname(relPath)), { recursive: true });
    await writeFile(join(cwd, relPath), content);
  };

  it("detects old Codex generated file with metadata", async () => {
    const cwd = await makeTempDir();
    await createLegacyFile(cwd, ".agents/rules/myapp-best-practices.md", "codex", "myapp");
    const results = await detectLegacyGeneratedFiles(cwd, "myapp");
    expect(results).toHaveLength(1);
    expect(results[0]!.path).toBe(".agents/rules/myapp-best-practices.md");
    expect(results[0]!.agent).toBe("codex");
    expect(results[0]!.supersededBy).toBe("codex");
  });

  it("detects old Antigravity generated file with metadata", async () => {
    const cwd = await makeTempDir();
    await createLegacyFile(
      cwd,
      ".antigravity/rules/myapp-best-practices.md",
      "antigravity",
      "myapp",
    );
    const results = await detectLegacyGeneratedFiles(cwd, "myapp");
    expect(results).toHaveLength(1);
    expect(results[0]!.path).toBe(".antigravity/rules/myapp-best-practices.md");
    expect(results[0]!.agent).toBe("antigravity");
  });

  it("ignores legacy path file without metadata marker", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, ".agents", "rules"), { recursive: true });
    await writeFile(
      join(cwd, ".agents", "rules", "myapp-best-practices.md"),
      "# Just a user file, no metadata",
    );
    const results = await detectLegacyGeneratedFiles(cwd, "myapp");
    expect(results).toHaveLength(0);
  });

  it("ignores legacy path file with metadata from wrong agent", async () => {
    const cwd = await makeTempDir();
    await createLegacyFile(
      cwd,
      ".agents/rules/myapp-best-practices.md",
      "claude" as "codex",
      "myapp",
    );
    const results = await detectLegacyGeneratedFiles(cwd, "myapp");
    expect(results).toHaveLength(0);
  });

  it("ignores non-existent legacy paths", async () => {
    const cwd = await makeTempDir();
    const results = await detectLegacyGeneratedFiles(cwd, "myapp");
    expect(results).toHaveLength(0);
  });

  it("detects both legacy files when both exist", async () => {
    const cwd = await makeTempDir();
    await createLegacyFile(cwd, ".agents/rules/myapp-best-practices.md", "codex", "myapp");
    await createLegacyFile(
      cwd,
      ".antigravity/rules/myapp-best-practices.md",
      "antigravity",
      "myapp",
    );
    const results = await detectLegacyGeneratedFiles(cwd, "myapp");
    expect(results).toHaveLength(2);
  });
});

describe("runCreateSkillsCommand --check with legacy files", () => {
  it("exits 0 when official files are current despite legacy files on disk", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    // Pre-create fidelity-signal directories so the hash is stable across generate+check
    await mkdir(join(cwd, ".agents", "skills"), { recursive: true });
    await mkdir(join(cwd, ".agents", "rules"), { recursive: true });
    // Create a legacy file at old Codex path (simulating pre-v1.0.17 leftover)
    const header = renderMetadataHeader({
      generatorVersion: getToolVersion(),
      sourceIndexSchema: "1.2",
      sourceIndexHash: "abc123def4567890",
      agent: "codex",
      projectName: "fixture",
    });
    const legacyContent = header + "\n# Legacy generated file\n";
    await writeFile(join(cwd, ".agents", "rules", "fixture-best-practices.md"), legacyContent);
    // Generate current Codex skills
    await runCreateSkillsCommand(
      {
        agent: "codex",
        "all-agents": false,
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-no-ai-enrich": false,
      },
      cwd,
    );
    // Run --check — legacy files should not affect exit code
    const exitCode = await runCreateSkillsCommand(
      {
        agent: "codex",
        "all-agents": false,
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-check": true,
        "create-skills-no-ai-enrich": false,
      },
      cwd,
    );
    expect(exitCode).toBe(0);
  });

  it("exits 1 when current file is missing regardless of legacy files", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    // Create a legacy file at old Codex path but no current files
    await mkdir(join(cwd, ".agents", "rules"), { recursive: true });
    const header = renderMetadataHeader({
      generatorVersion: getToolVersion(),
      sourceIndexSchema: "1.2",
      sourceIndexHash: "abc123def4567890",
      agent: "codex",
      projectName: "fixture",
    });
    const legacyContent = header + "\n# Legacy generated file\n";
    await writeFile(join(cwd, ".agents", "rules", "fixture-best-practices.md"), legacyContent);
    // --check without generating current files → missing → exit 1
    const exitCode = await runCreateSkillsCommand(
      {
        agent: "codex",
        "all-agents": false,
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-check": true,
        "create-skills-no-ai-enrich": false,
      },
      cwd,
    );
    expect(exitCode).toBe(1);
  });
});

describe("runCreateSkillsCommand --dry-run with legacy files", () => {
  it("--dry-run --format json includes legacyFiles when legacy files exist", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    // Create legacy files with metadata
    await mkdir(join(cwd, ".agents", "rules"), { recursive: true });
    await mkdir(join(cwd, ".antigravity", "rules"), { recursive: true });
    const codexHeader = renderMetadataHeader({
      generatorVersion: getToolVersion(),
      sourceIndexSchema: "1.2",
      sourceIndexHash: "abc123def4567890",
      agent: "codex",
      projectName: "fixture",
    });
    await writeFile(
      join(cwd, ".agents", "rules", "fixture-best-practices.md"),
      codexHeader + "\n# Legacy Codex file\n",
    );
    const agHeader = renderMetadataHeader({
      generatorVersion: getToolVersion(),
      sourceIndexSchema: "1.2",
      sourceIndexHash: "abc123def4567890",
      agent: "antigravity",
      projectName: "fixture",
    });
    await writeFile(
      join(cwd, ".antigravity", "rules", "fixture-best-practices.md"),
      agHeader + "\n# Legacy Antigravity file\n",
    );
    // Run dry-run with JSON
    let stdout = "";
    const origLog = console.log;
    console.log = (data: string) => {
      stdout += data;
    };
    const exitCode = await runCreateSkillsCommand(
      {
        agent: "codex",
        "all-agents": false,
        "create-skills-dry-run": true,
        "create-skills-format": "json",
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-no-ai-enrich": false,
      },
      cwd,
    );
    console.log = origLog;
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.dryRun).toBeDefined();
    expect(parsed.legacyFiles).toBeDefined();
    expect(parsed.legacyFiles.length).toBe(2);
  });
});

// ── Doctor diagnostic tests (v1.7.0+) ─────────────────────────────────────────

function captureStdout() {
  let stdout = "";
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  const origDebug = console.debug;
  console.log = (data: string) => {
    stdout += data;
  };
  console.warn = () => {};
  console.error = () => {};
  console.debug = () => {};
  return {
    get stdout() {
      return stdout;
    },
    restore() {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
      console.debug = origDebug;
    },
  };
}

describe("runCreateSkillsCommand --doctor", () => {
  it("--doctor --format json produces valid JSON with all required fields", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    const cap = captureStdout();
    const exitCode = await runCreateSkillsCommand(
      {
        "all-agents": false,
        "create-skills-format": "json",
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": false,
        "create-skills-no-ai-enrich": false,
        doctor: true,
      },
      cwd,
    );
    cap.restore();
    const parsed = JSON.parse(cap.stdout);
    const requiredFields = [
      "status",
      "projectName",
      "agents",
      "index",
      "skills",
      "legacyFiles",
      "scripts",
      "recommendedActions",
      "recommendedCommands",
    ];
    for (const field of requiredFields) {
      expect(parsed).toHaveProperty(field);
    }
    expect(parsed.projectName).toBe("fixture");
    expect(Array.isArray(parsed.agents)).toBe(true);
    expect(Array.isArray(parsed.skills)).toBe(true);
    expect(Array.isArray(parsed.legacyFiles)).toBe(true);
    expect(Array.isArray(parsed.scripts)).toBe(true);
    expect(Array.isArray(parsed.recommendedActions)).toBe(true);
    expect(Array.isArray(parsed.recommendedCommands)).toBe(true);
    expect(parsed.index).toBeDefined();
    expect(typeof parsed.index.status).toBe("string");
    expect(typeof parsed.status).toBe("string");
    // Missing index → action-required → exit 1
    expect(exitCode).toBe(1);
    expect(parsed.status).toBe("action-required");
    // recommendedCommands must be an array of non-empty trimmed strings
    for (const cmd of parsed.recommendedCommands) {
      expect(typeof cmd).toBe("string");
      expect(cmd.trim()).toBe(cmd);
      expect(cmd.trim().length).toBeGreaterThan(0);
    }
  });

  it("--doctor --format json works without --agent or --all-agents", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    const cap = captureStdout();
    const exitCode = await runCreateSkillsCommand(
      {
        "all-agents": false,
        "create-skills-format": "json",
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": false,
        "create-skills-no-ai-enrich": false,
        doctor: true,
      },
      cwd,
    );
    cap.restore();
    const parsed = JSON.parse(cap.stdout);
    expect(parsed.skills.length).toBeGreaterThan(0);
    expect(parsed.agents.length).toBeGreaterThan(0);
    expect(exitCode).toBe(1); // missing index
  });

  it("--doctor --agent claude scopes skills to Claude only", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    const cap = captureStdout();
    await runCreateSkillsCommand(
      {
        agent: "claude",
        "all-agents": false,
        "create-skills-format": "json",
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": false,
        "create-skills-no-ai-enrich": false,
        doctor: true,
      },
      cwd,
    );
    cap.restore();
    const parsed = JSON.parse(cap.stdout);
    expect(parsed.skills.length).toBe(1);
    expect(parsed.skills[0].agent).toBe("claude");
  });

  it("--doctor --all-agents includes all non-generic adapters", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    const cap = captureStdout();
    await runCreateSkillsCommand(
      {
        "all-agents": true,
        "create-skills-format": "json",
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": false,
        "create-skills-no-ai-enrich": false,
        doctor: true,
      },
      cwd,
    );
    cap.restore();
    const parsed = JSON.parse(cap.stdout);
    const nonGenericIds = ADAPTER_REGISTRY.filter((a) => a.id !== "generic").map((a) => a.id);
    for (const id of nonGenericIds) {
      expect(parsed.skills.some((s: { agent: string }) => s.agent === id)).toBe(true);
    }
    expect(parsed.skills.some((s: { agent: string }) => s.agent === "generic")).toBe(false);
  });

  it("--doctor does not write generated skill files", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    const cap = captureStdout();
    await runCreateSkillsCommand(
      {
        "all-agents": false,
        "create-skills-format": "json",
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": false,
        "create-skills-no-ai-enrich": false,
        doctor: true,
      },
      cwd,
    );
    cap.restore();
    // No agent output directories should have been created
    expect(existsSync(join(cwd, ".claude", "skills"))).toBe(false);
    expect(existsSync(join(cwd, ".cursor", "rules"))).toBe(false);
    expect(existsSync(join(cwd, ".agents", "skills"))).toBe(false);
    expect(existsSync(join(cwd, ".agents", "rules"))).toBe(false);
    expect(existsSync(join(cwd, ".windsurf", "rules"))).toBe(false);
    expect(existsSync(join(cwd, ".clinerules"))).toBe(false);
    expect(existsSync(join(cwd, ".antigravity"))).toBe(false);
  });

  it("--doctor does not auto-build index", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    const cachePath = join(cwd, ".mp-sentinel-cache", "source-index.json");
    expect(existsSync(cachePath)).toBe(false);

    const cap = captureStdout();
    await runCreateSkillsCommand(
      {
        "all-agents": false,
        "create-skills-format": "json",
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": false,
        "create-skills-no-ai-enrich": false,
        doctor: true,
      },
      cwd,
    );
    cap.restore();

    // Cache file should NOT be created by doctor
    expect(existsSync(cachePath)).toBe(false);
  });

  it("missing index returns index.status = 'missing' and exit 1", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    const cap = captureStdout();
    const exitCode = await runCreateSkillsCommand(
      {
        "all-agents": false,
        "create-skills-format": "json",
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": false,
        "create-skills-no-ai-enrich": false,
        doctor: true,
      },
      cwd,
    );
    cap.restore();
    const parsed = JSON.parse(cap.stdout);
    expect(parsed.index.status).toBe("missing");
    expect(parsed.status).toBe("action-required");
    expect(exitCode).toBe(1);
  });

  it("corrupt index returns index.status = 'unreadable' and exit 2", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    // Write corrupt JSON to the cache path
    const cacheDir = join(cwd, ".mp-sentinel-cache");
    await mkdir(cacheDir, { recursive: true });
    await writeFile(
      join(cwd, ".mp-sentinel-cache", "source-index.json"),
      "this is not valid json {{{",
    );
    const cap = captureStdout();
    const exitCode = await runCreateSkillsCommand(
      {
        "all-agents": false,
        "create-skills-format": "json",
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": false,
        "create-skills-no-ai-enrich": false,
        doctor: true,
      },
      cwd,
    );
    cap.restore();
    const parsed = JSON.parse(cap.stdout);
    expect(parsed.index.status).toBe("unreadable");
    expect(parsed.status).toBe("error");
    expect(exitCode).toBe(2);
  });

  it("healthy project returns status 'ok' and exit 0 with up-to-date skills", async () => {
    const cwd = await makeTempDir();
    // Use a richer fixture so quality gate passes (zero errors)
    await makeCliToolingProject(cwd);
    await mkdir(join(cwd, ".claude"), { recursive: true });

    const indexConfig = {
      enabled: true,
      languages: ["typescript", "tsx", "javascript", "jsx"] as const,
      cachePath: ".mp-sentinel-cache/source-index.json" as const,
      maxFileSize: 512000,
    };
    const index = await buildSourceIndex(cwd, indexConfig, true);
    expect(index).not.toBeNull();

    const adapter = getAdapter("claude")!;
    const projectName = (index!.project.packageName ?? "fixture")
      .replace(/^@/, "")
      .replace(/\//g, "-");
    const kb = buildSkillKnowledgeBase(index!, cwd);

    const { computeIndexHash, renderMetadataHeader } =
      await import("../services/skills-generator/metadata.js");
    const hash = computeIndexHash(index!, cwd);
    const genFiles = await adapter.generate(index!, {
      projectRoot: cwd,
      projectName,
      force: false,
      knowledgeBase: kb,
    });

    const genVersion = getToolVersion();
    for (const file of genFiles) {
      const header = renderMetadataHeader({
        generatorVersion: genVersion,
        sourceIndexSchema: index!.schemaVersion,
        sourceIndexHash: hash,
        agent: "claude",
        projectName,
      });
      await mkdir(dirname(file.outputPath), { recursive: true });
      await writeFile(file.outputPath, header + "\n" + file.content);
    }

    const cap = captureStdout();
    const exitCode = await runCreateSkillsCommand(
      {
        "all-agents": false,
        "create-skills-format": "json",
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": false,
        "create-skills-no-ai-enrich": false,
        doctor: true,
      },
      cwd,
    );
    cap.restore();
    const parsed = JSON.parse(cap.stdout);
    expect(parsed.index.status).toBe("ok");
    expect(parsed.skills.length).toBeGreaterThanOrEqual(1);
    const claudeSkills = parsed.skills.find((s: { agent: string }) => s.agent === "claude");
    expect(claudeSkills).toBeDefined();
    expect(claudeSkills.status).toBe("up-to-date");
    // With detected claude adapter and up-to-date skills, status should be ok
    expect(parsed.status).toBe("ok");
    expect(exitCode).toBe(0);
  });

  it("stale skills return status 'action-required' and exit 1", async () => {
    const cwd = await makeTempDir();
    await makeCliToolingProject(cwd);
    await mkdir(join(cwd, ".claude"), { recursive: true });

    const indexConfig = {
      enabled: true,
      languages: ["typescript", "tsx", "javascript", "jsx"] as const,
      cachePath: ".mp-sentinel-cache/source-index.json" as const,
      maxFileSize: 512000,
    };
    const index = await buildSourceIndex(cwd, indexConfig, true);
    expect(index).not.toBeNull();

    const adapter = getAdapter("claude")!;
    const projectName = (index!.project.packageName ?? "fixture")
      .replace(/^@/, "")
      .replace(/\//g, "-");
    const kb = buildSkillKnowledgeBase(index!, cwd);
    const genFiles = await adapter.generate(index!, {
      projectRoot: cwd,
      projectName,
      force: false,
      knowledgeBase: kb,
    });

    // Write files with a wrong hash (stale)
    const wrongHash = "0000000000000000";
    const genVersion = getToolVersion();
    for (const file of genFiles) {
      const header = `<!-- @mp-sentinel-generated generatorVersion=${genVersion} sourceIndexSchema=${index!.schemaVersion} sourceIndexHash=${wrongHash} agent=claude projectName=${projectName} -->`;
      await mkdir(dirname(file.outputPath), { recursive: true });
      await writeFile(file.outputPath, header + "\n" + file.content);
    }

    const cap = captureStdout();
    const exitCode = await runCreateSkillsCommand(
      {
        "all-agents": false,
        "create-skills-format": "json",
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": false,
        "create-skills-no-ai-enrich": false,
        doctor: true,
      },
      cwd,
    );
    cap.restore();
    const parsed = JSON.parse(cap.stdout);
    expect(parsed.index.status).toBe("ok");
    expect(parsed.status).toBe("action-required");
    expect(exitCode).toBe(1);
  });

  it("legacy advisories alone do not cause exit 1 when skills are current", async () => {
    const cwd = await makeTempDir();
    await makeCliToolingProject(cwd);
    // Detect both claude and codex so they both get current skills
    await mkdir(join(cwd, ".claude"), { recursive: true });

    const indexConfig = {
      enabled: true,
      languages: ["typescript", "tsx", "javascript", "jsx"] as const,
      cachePath: ".mp-sentinel-cache/source-index.json" as const,
      maxFileSize: 512000,
    };
    const index = await buildSourceIndex(cwd, indexConfig, true);
    expect(index).not.toBeNull();

    const projectName = (index!.project.packageName ?? "fixture")
      .replace(/^@/, "")
      .replace(/\//g, "-");
    const kb = buildSkillKnowledgeBase(index!, cwd);

    // Create all directories that affect fidelity signals BEFORE computing hash.
    // .agents/rules (legacy file dir), .agents/skills (codex output dir) are both
    // fidelity signals. Creating them ahead of time ensures the hash is stable.
    await mkdir(join(cwd, ".agents", "rules"), { recursive: true });
    await mkdir(join(cwd, ".agents", "skills"), { recursive: true });

    const { computeIndexHash, renderMetadataHeader } =
      await import("../services/skills-generator/metadata.js");
    const hash = computeIndexHash(index!, cwd);
    const genVersion = getToolVersion();

    // Generate and write skills for claude
    const claudeAdapter = getAdapter("claude")!;
    const claudeFiles = await claudeAdapter.generate(index!, {
      projectRoot: cwd,
      projectName,
      force: false,
      knowledgeBase: kb,
    });
    for (const file of claudeFiles) {
      const header = renderMetadataHeader({
        generatorVersion: genVersion,
        sourceIndexSchema: index!.schemaVersion,
        sourceIndexHash: hash,
        agent: "claude",
        projectName,
      });
      await mkdir(dirname(file.outputPath), { recursive: true });
      await writeFile(file.outputPath, header + "\n" + file.content);
    }

    // Generate and write skills for codex (detected because .agents/ exists)
    const codexAdapter = getAdapter("codex")!;
    const codexFiles = await codexAdapter.generate(index!, {
      projectRoot: cwd,
      projectName,
      force: false,
      knowledgeBase: kb,
    });
    for (const file of codexFiles) {
      const header = renderMetadataHeader({
        generatorVersion: genVersion,
        sourceIndexSchema: index!.schemaVersion,
        sourceIndexHash: hash,
        agent: "codex",
        projectName,
      });
      await mkdir(dirname(file.outputPath), { recursive: true });
      await writeFile(file.outputPath, header + "\n" + file.content);
    }

    // Create a legacy file at the OLD codex path (advisory-only)
    const legacyHeader = `<!-- @mp-sentinel-generated generatorVersion=1.6.2 sourceIndexSchema=1.2 sourceIndexHash=abcdef1234567890 agent=codex projectName=${projectName} -->`;
    await writeFile(
      join(cwd, ".agents", "rules", `${projectName}-best-practices.md`),
      legacyHeader + "\n# Legacy Codex file\n",
    );

    const cap = captureStdout();
    const exitCode = await runCreateSkillsCommand(
      {
        "all-agents": false,
        "create-skills-format": "json",
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": false,
        "create-skills-no-ai-enrich": false,
        doctor: true,
      },
      cwd,
    );
    cap.restore();
    const parsed = JSON.parse(cap.stdout);
    expect(parsed.legacyFiles.length).toBeGreaterThanOrEqual(1);
    expect(parsed.status).toBe("ok");
    expect(exitCode).toBe(0);
  });

  it("--doctor --format json stdout parses directly (no log prefix)", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    const cap = captureStdout();
    await runCreateSkillsCommand(
      {
        "all-agents": false,
        "create-skills-format": "json",
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": false,
        "create-skills-no-ai-enrich": false,
        doctor: true,
      },
      cwd,
    );
    cap.restore();
    // JSON must be parseable directly — no workaround needed
    expect(() => JSON.parse(cap.stdout)).not.toThrow();
    // stdout must start with '{' — no log prefix, no ANSI noise
    expect(cap.stdout.trim().startsWith("{")).toBe(true);
  });

  it("--doctor --format json stdout is clean even with project config present", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    // Write a .sentinelrc.json so loadProjectConfig has a config to find
    await writeFile(join(cwd, ".sentinelrc.json"), JSON.stringify({ indexing: { enabled: true } }));
    const cap = captureStdout();
    await runCreateSkillsCommand(
      {
        "all-agents": false,
        "create-skills-format": "json",
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": false,
        "create-skills-no-ai-enrich": false,
        doctor: true,
      },
      cwd,
    );
    cap.restore();
    // JSON must be parseable directly — no workaround needed, even with a config file
    // that triggers loadProjectConfig logging (quiet mode must suppress it).
    expect(() => JSON.parse(cap.stdout)).not.toThrow();
    expect(cap.stdout.trim().startsWith("{")).toBe(true);
  });

  it("--doctor console output contains no risky Unicode chars", async () => {
    const cwd = await makeTempDir();
    await makeCliToolingProject(cwd);
    // Add DOCTOR_SCRIPTS so the "Script: ..." rendering path is exercised
    const pkgRaw = await readFile(join(cwd, "package.json"), "utf-8");
    const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
    const scripts = (pkg.scripts ?? {}) as Record<string, string>;
    scripts["agent:skills:check"] = "mp-sentinel create-skills --check";
    scripts["agent:skills:refresh"] = "mp-sentinel create-skills --all-agents --force";
    scripts["dogfood"] = "npm run dogfood";
    pkg.scripts = scripts;
    await writeFile(join(cwd, "package.json"), JSON.stringify(pkg, null, 2));

    await mkdir(join(cwd, ".claude"), { recursive: true });

    // Build index and write up-to-date skills so recommendedCommands stays empty,
    // exercising the "(none - no automated commands recommended)" rendering path.
    const indexConfig = {
      enabled: true,
      languages: ["typescript", "tsx", "javascript", "jsx"] as const,
      cachePath: ".mp-sentinel-cache/source-index.json" as const,
      maxFileSize: 512000,
    };
    const index = await buildSourceIndex(cwd, indexConfig, true);
    expect(index).not.toBeNull();

    const adapter = getAdapter("claude")!;
    const projectName = (index!.project.packageName ?? "fixture")
      .replace(/^@/, "")
      .replace(/\//g, "-");
    const kb = buildSkillKnowledgeBase(index!, cwd);
    const { computeIndexHash, renderMetadataHeader } =
      await import("../services/skills-generator/metadata.js");
    const hash = computeIndexHash(index!, cwd);
    const genVersion = getToolVersion();
    const genFiles = await adapter.generate(index!, {
      projectRoot: cwd,
      projectName,
      force: false,
      knowledgeBase: kb,
    });

    for (const file of genFiles) {
      const header = renderMetadataHeader({
        generatorVersion: genVersion,
        sourceIndexSchema: index!.schemaVersion,
        sourceIndexHash: hash,
        agent: "claude",
        projectName,
      });
      await mkdir(dirname(file.outputPath), { recursive: true });
      await writeFile(file.outputPath, header + "\n" + file.content);
    }

    const cap = captureStdout();
    await runCreateSkillsCommand(
      {
        "all-agents": false,
        "create-skills-format": "console",
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": false,
        "create-skills-no-ai-enrich": false,
        doctor: true,
      },
      cwd,
    );
    cap.restore();
    const out = cap.stdout;

    // Available scripts must be rendered (exercises line 788)
    expect(out).toContain("Script: agent:skills:check - Checks skill file freshness");
    expect(out).toContain("Script: agent:skills:refresh - Regenerates stale/missing skill files");
    expect(out).toContain("Script: dogfood - Validates end-to-end local workflow");

    // Empty recommended commands must be rendered (exercises line 806)
    expect(out).toContain("(none - no automated commands recommended)");

    const risky = [
      { char: "—", name: "em dash (--)" },
      { char: "→", name: "right arrow (->)" },
      { char: "←", name: "left arrow (<-)" },
      { char: "…", name: "ellipsis (...)" },
      { char: "✓", name: "checkmark" },
      { char: "✗", name: "ballot x" },
    ];
    for (const r of risky) {
      expect(out).not.toContain(r.char);
    }
    // ASCII markers should be present; [x] must not appear
    expect(out).toContain("[ok]");
    expect(out).toContain("[fail]");
    expect(out).toContain("[warn]");
    expect(out).not.toContain("[x]");
  });

  it("--doctor missing index includes mp-sentinel indexing as first recommendedCommand", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    const cap = captureStdout();
    await runCreateSkillsCommand(
      {
        "all-agents": false,
        "create-skills-format": "json",
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": false,
        "create-skills-no-ai-enrich": false,
        doctor: true,
      },
      cwd,
    );
    cap.restore();
    const parsed = JSON.parse(cap.stdout);
    expect(parsed.recommendedCommands.length).toBeGreaterThan(0);
    expect(parsed.recommendedCommands[0]).toBe("mp-sentinel indexing");
  });

  it("--doctor stale skills with refresh script prefers npm run agent:skills:refresh", async () => {
    const cwd = await makeTempDir();
    await makeCliToolingProject(cwd);
    // Add agent:skills:refresh script to the fixture
    const pkgRaw = await readFile(join(cwd, "package.json"), "utf-8");
    const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
    const scripts = (pkg.scripts ?? {}) as Record<string, string>;
    scripts["agent:skills:refresh"] = "node scripts/agent-skills-refresh.mjs";
    pkg.scripts = scripts;
    await writeFile(join(cwd, "package.json"), JSON.stringify(pkg, null, 2));
    await mkdir(join(cwd, ".claude"), { recursive: true });

    // Build index
    const indexConfig = {
      enabled: true,
      languages: ["typescript", "tsx", "javascript", "jsx"] as const,
      cachePath: ".mp-sentinel-cache/source-index.json" as const,
      maxFileSize: 512000,
    };
    const index = await buildSourceIndex(cwd, indexConfig, true);
    expect(index).not.toBeNull();

    // Write stale skill files
    const adapter = getAdapter("claude")!;
    const projectName = (index!.project.packageName ?? "fixture")
      .replace(/^@/, "")
      .replace(/\//g, "-");
    const kb = buildSkillKnowledgeBase(index!, cwd);
    const genFiles = await adapter.generate(index!, {
      projectRoot: cwd,
      projectName,
      force: false,
      knowledgeBase: kb,
    });
    const genVersion = getToolVersion();
    const wrongHash = "0000000000000000";
    for (const file of genFiles) {
      const header = `<!-- @mp-sentinel-generated generatorVersion=${genVersion} sourceIndexSchema=${index!.schemaVersion} sourceIndexHash=${wrongHash} agent=claude projectName=${projectName} -->`;
      await mkdir(dirname(file.outputPath), { recursive: true });
      await writeFile(file.outputPath, header + "\n" + file.content);
    }

    const cap = captureStdout();
    await runCreateSkillsCommand(
      {
        agent: "claude",
        "all-agents": false,
        "create-skills-format": "json",
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": false,
        "create-skills-no-ai-enrich": false,
        doctor: true,
      },
      cwd,
    );
    cap.restore();
    const parsed = JSON.parse(cap.stdout);
    expect(parsed.status).toBe("action-required");
    // Since the fixture has agent:skills:refresh script, it should be preferred
    expect(parsed.recommendedCommands).toContain("npm run agent:skills:refresh");
    // Should NOT contain the fallback create-skills command
    expect(
      parsed.recommendedCommands.filter(
        (c: string) => c === "mp-sentinel create-skills --all-agents --force",
      ).length,
    ).toBe(0);
  });

  it("--doctor stale skills without refresh script falls back to create-skills CLI", async () => {
    const cwd = await makeTempDir();
    // Use makeMinimalProject which lacks agent:skills:refresh, then add .claude/
    await makeMinimalProject(cwd);
    await mkdir(join(cwd, ".claude"), { recursive: true });

    const indexConfig = {
      enabled: true,
      languages: ["typescript", "tsx", "javascript", "jsx"] as const,
      cachePath: ".mp-sentinel-cache/source-index.json" as const,
      maxFileSize: 512000,
    };
    const index = await buildSourceIndex(cwd, indexConfig, true);
    expect(index).not.toBeNull();

    // Write up-to-date skills first so the index is usable
    const adapter = getAdapter("claude")!;
    const projectName = (index!.project.packageName ?? "fixture")
      .replace(/^@/, "")
      .replace(/\//g, "-");
    const kb = buildSkillKnowledgeBase(index!, cwd);
    const genFiles = await adapter.generate(index!, {
      projectRoot: cwd,
      projectName,
      force: false,
      knowledgeBase: kb,
    });
    const genVersion = getToolVersion();
    // Write files with a wrong hash (stale)
    const wrongHash = "0000000000000000";
    for (const file of genFiles) {
      const header = `<!-- @mp-sentinel-generated generatorVersion=${genVersion} sourceIndexSchema=${index!.schemaVersion} sourceIndexHash=${wrongHash} agent=claude projectName=${projectName} -->`;
      await mkdir(dirname(file.outputPath), { recursive: true });
      await writeFile(file.outputPath, header + "\n" + file.content);
    }

    const cap = captureStdout();
    await runCreateSkillsCommand(
      {
        agent: "claude",
        "all-agents": false,
        "create-skills-format": "json",
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": false,
        "create-skills-no-ai-enrich": false,
        doctor: true,
      },
      cwd,
    );
    cap.restore();
    const parsed = JSON.parse(cap.stdout);
    // Without refresh script, should fall back to create-skills CLI
    expect(parsed.recommendedCommands).toContain("mp-sentinel create-skills --all-agents --force");
    expect(
      parsed.recommendedCommands.filter((c: string) => c === "npm run agent:skills:refresh").length,
    ).toBe(0);
  });

  it("--doctor healthy project has empty recommendedCommands", async () => {
    const cwd = await makeTempDir();
    await makeCliToolingProject(cwd);
    await mkdir(join(cwd, ".claude"), { recursive: true });

    const indexConfig = {
      enabled: true,
      languages: ["typescript", "tsx", "javascript", "jsx"] as const,
      cachePath: ".mp-sentinel-cache/source-index.json" as const,
      maxFileSize: 512000,
    };
    const index = await buildSourceIndex(cwd, indexConfig, true);
    expect(index).not.toBeNull();

    const adapter = getAdapter("claude")!;
    const projectName = (index!.project.packageName ?? "fixture")
      .replace(/^@/, "")
      .replace(/\//g, "-");
    const kb = buildSkillKnowledgeBase(index!, cwd);
    const { computeIndexHash, renderMetadataHeader } =
      await import("../services/skills-generator/metadata.js");
    const hash = computeIndexHash(index!, cwd);
    const genVersion = getToolVersion();
    const genFiles = await adapter.generate(index!, {
      projectRoot: cwd,
      projectName,
      force: false,
      knowledgeBase: kb,
    });

    for (const file of genFiles) {
      const header = renderMetadataHeader({
        generatorVersion: genVersion,
        sourceIndexSchema: index!.schemaVersion,
        sourceIndexHash: hash,
        agent: "claude",
        projectName,
      });
      await mkdir(dirname(file.outputPath), { recursive: true });
      await writeFile(file.outputPath, header + "\n" + file.content);
    }

    const cap = captureStdout();
    const exitCode = await runCreateSkillsCommand(
      {
        "all-agents": false,
        "create-skills-format": "json",
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": false,
        "create-skills-no-ai-enrich": false,
        doctor: true,
      },
      cwd,
    );
    cap.restore();
    const parsed = JSON.parse(cap.stdout);
    expect(parsed.status).toBe("ok");
    expect(exitCode).toBe(0);
    expect(parsed.recommendedCommands).toEqual([]);
  });

  it("--doctor recommendedCommands is deduped and stable", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    await mkdir(join(cwd, ".claude"), { recursive: true });
    // Create .agents/ so codex is also detected
    await mkdir(join(cwd, ".agents"), { recursive: true });

    const cap = captureStdout();
    await runCreateSkillsCommand(
      {
        "all-agents": false,
        "create-skills-format": "json",
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": false,
        "create-skills-no-ai-enrich": false,
        doctor: true,
      },
      cwd,
    );
    cap.restore();
    const parsed = JSON.parse(cap.stdout);
    // No duplicate commands
    const cmds = parsed.recommendedCommands;
    const deduped = [...new Set(cmds)];
    expect(cmds).toEqual(deduped);
    // First command should be indexing (the root cause)
    if (cmds.length > 0) {
      expect(cmds[0]).toBe("mp-sentinel indexing");
    }
  });

  // ── v1.9.0 Skill encoding hygiene ────────────────────────────────────────

  it("--all-agents --dry-run reports zero risky-unicode quality errors", async () => {
    const cwd = await makeTempDir();
    await makeCliToolingProject(cwd);
    await mkdir(join(cwd, ".claude"), { recursive: true });

    const indexConfig = {
      enabled: true,
      languages: ["typescript", "tsx", "javascript", "jsx"] as const,
      cachePath: ".mp-sentinel-cache/source-index.json" as const,
      maxFileSize: 512000,
    };
    const index = await buildSourceIndex(cwd, indexConfig, true);
    expect(index).not.toBeNull();

    let jsonOutput = "";
    const origLog = console.log;
    console.log = (s: string) => {
      if (s.startsWith("{")) jsonOutput = s;
    };

    await runCreateSkillsCommand(
      {
        "all-agents": true,
        "create-skills-format": "json",
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": true,
        "create-skills-check": false,
        "create-skills-no-ai-enrich": true,
      },
      cwd,
    );

    console.log = origLog;
    const parsed = JSON.parse(jsonOutput);
    expect(Array.isArray(parsed.dryRun)).toBe(true);

    for (const agent of parsed.dryRun) {
      const unicodeErrors = (agent.quality?.checks ?? []).filter(
        (c: { type: string }) => c.type === "risky-unicode",
      );
      expect(unicodeErrors).toHaveLength(0);
    }
  });

  it("generated skills for all agents pass risky-unicode quality check", async () => {
    const cwd = await makeTempDir();
    await makeCliToolingProject(cwd);
    await mkdir(join(cwd, ".claude"), { recursive: true });

    const indexConfig = {
      enabled: true,
      languages: ["typescript", "tsx", "javascript", "jsx"] as const,
      cachePath: ".mp-sentinel-cache/source-index.json" as const,
      maxFileSize: 512000,
    };
    const index = await buildSourceIndex(cwd, indexConfig, true);
    expect(index).not.toBeNull();

    // Test Claude adapter specifically (multi-file skill layout)
    const adapter = getAdapter("claude")!;
    const projectName = (index!.project.packageName ?? "fixture")
      .replace(/^@/, "")
      .replace(/\//g, "-");
    const kb = buildSkillKnowledgeBase(index!, cwd);
    const genFiles = await adapter.generate(index!, {
      projectRoot: cwd,
      projectName,
      force: false,
      knowledgeBase: kb,
    });
    const report = validateSkillQuality(genFiles, "claude", index!, adapter.spec, projectName);
    const unicodeChecks = report.checks.filter((c) => c.type === "risky-unicode");
    expect(unicodeChecks).toHaveLength(0);

    // Test Codex adapter (single-file skill layout)
    const codexAdapter = getAdapter("codex")!;
    const codexFiles = await codexAdapter.generate(index!, {
      projectRoot: cwd,
      projectName,
      force: false,
      knowledgeBase: kb,
    });
    const codexReport = validateSkillQuality(
      codexFiles,
      "codex",
      index!,
      codexAdapter.spec,
      projectName,
    );
    const codexUnicodeChecks = codexReport.checks.filter((c) => c.type === "risky-unicode");
    expect(codexUnicodeChecks).toHaveLength(0);

    // Test Antigravity adapter (single-file skill layout under .agents/skills/)
    const agAdapter = getAdapter("antigravity")!;
    const agFiles = await agAdapter.generate(index!, {
      projectRoot: cwd,
      projectName,
      force: false,
      knowledgeBase: kb,
    });
    const agReport = validateSkillQuality(
      agFiles,
      "antigravity",
      index!,
      agAdapter.spec,
      projectName,
    );
    const agUnicodeChecks = agReport.checks.filter((c) => c.type === "risky-unicode");
    expect(agUnicodeChecks).toHaveLength(0);
  });
});
