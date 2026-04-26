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
  it("has 6 adapters", () => {
    expect(ADAPTER_REGISTRY).toHaveLength(6);
  });

  it("getAdapter returns the right adapter", () => {
    expect(getAdapter("claude")?.id).toBe("claude");
    expect(getAdapter("cursor")?.id).toBe("cursor");
    expect(getAdapter("codex")?.id).toBe("codex");
    expect(getAdapter("windsurf")?.id).toBe("windsurf");
    expect(getAdapter("antigravity")?.id).toBe("antigravity");
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
  it("creates SKILL.md + 3 reference files", async () => {
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
    expect(files.length).toBe(4);
    expect(files.some((f) => f.outputPath.endsWith("SKILL.md"))).toBe(true);
    expect(files.some((f) => f.outputPath.includes("references"))).toBe(true);
    const skillMd = files.find((f) => f.outputPath.endsWith("SKILL.md"))!;
    expect(skillMd.content).toContain("name: fixture-best-practices");
  });
});

describe("Cursor adapter generate()", () => {
  it("creates a single .mdc file", async () => {
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
