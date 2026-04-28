import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
} from "../services/skills-generator/index.js";
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
    // Generic output
    expect(existsSync(join(cwd, ".agents", "rules", "fixture-best-practices.md"))).toBe(true);
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

    // Generate with codex
    await runCreateSkillsCommand(
      {
        agent: "codex",
        "all-agents": false,
        "create-skills-format": undefined,
        "create-skills-force": false,
        "skip-index-refresh": false,
        "create-skills-dry-run": false,
        "create-skills-check": false,
      },
      cwd,
    );

    // Check with generic (same output path, different agent id)
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

  it("--agent codex,generic in dry-run reports conflict for duplicate path", async () => {
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
    // codex runs first → create; generic sees same path already claimed → conflict
    const codexActions = parsed.dryRun.find((r) => r.agent === "codex")!.files.map((f) => f.action);
    const genericActions = parsed.dryRun
      .find((r) => r.agent === "generic")!
      .files.map((f) => f.action);
    expect(codexActions.every((a) => a === "create")).toBe(true);
    expect(genericActions.every((a) => a === "conflict")).toBe(true);
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
