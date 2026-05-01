import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "@jest/globals";

import { runCreateSkillsCommand } from "../commands/create-skills.js";
import type { CreateSkillsValues } from "../commands/create-skills.js";
import {
  ADAPTER_REGISTRY,
  detectAdapters,
  explainAgentDetection,
} from "../services/skills-generator/index.js";
import type { ExplainAgentEntry } from "../types/index.js";

// -- Fixtures ------------------------------------------------------------------

const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "mp-sentinel-explain-"));
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

type CreateSkillsValuesInput = Omit<
  Partial<CreateSkillsValues>,
  | "agent"
  | "create-skills-format"
  | "create-skills-dry-run"
  | "create-skills-check"
  | "explain-agents"
  | "doctor"
> & {
  agent?: string | undefined;
  "create-skills-format"?: string | undefined;
  "create-skills-dry-run"?: boolean | undefined;
  "create-skills-check"?: boolean | undefined;
  "explain-agents"?: boolean | undefined;
  doctor?: boolean | undefined;
};

const createSkillsValues = (overrides: CreateSkillsValuesInput = {}): CreateSkillsValues => ({
  "all-agents": overrides["all-agents"] ?? false,
  "create-skills-force": overrides["create-skills-force"] ?? false,
  "skip-index-refresh": overrides["skip-index-refresh"] ?? false,
  "create-skills-no-ai-enrich": overrides["create-skills-no-ai-enrich"] ?? false,
  ...(overrides.agent !== undefined && { agent: overrides.agent }),
  ...(overrides["create-skills-format"] !== undefined && {
    "create-skills-format": overrides["create-skills-format"],
  }),
  ...(overrides["create-skills-dry-run"] !== undefined && {
    "create-skills-dry-run": overrides["create-skills-dry-run"],
  }),
  ...(overrides["create-skills-check"] !== undefined && {
    "create-skills-check": overrides["create-skills-check"],
  }),
  ...(overrides["explain-agents"] !== undefined && {
    "explain-agents": overrides["explain-agents"],
  }),
  ...(overrides.doctor !== undefined && { doctor: overrides.doctor }),
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

// -- Registry detection edge cases ---------------------------------------------

describe("registry detection edge cases", () => {
  it("detects claude when .claude/ exists", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, ".claude"), { recursive: true });
    const detected = detectAdapters(cwd);
    expect(detected.some((a) => a.id === "claude")).toBe(true);
  });

  it("does NOT detect claude when only root CLAUDE.md exists", async () => {
    const cwd = await makeTempDir();
    await writeFile(join(cwd, "CLAUDE.md"), "# Claude instructions");
    const detected = detectAdapters(cwd);
    expect(detected.some((a) => a.id === "claude")).toBe(false);
  });

  it("detects codex when .codex/ exists", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, ".codex"), { recursive: true });
    const detected = detectAdapters(cwd);
    expect(detected.some((a) => a.id === "codex")).toBe(true);
  });

  it("detects codex when .agents/ exists", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, ".agents"), { recursive: true });
    const detected = detectAdapters(cwd);
    expect(detected.some((a) => a.id === "codex")).toBe(true);
  });

  it("does NOT detect codex when only root AGENTS.md exists", async () => {
    const cwd = await makeTempDir();
    await writeFile(join(cwd, "AGENTS.md"), "# Agent instructions");
    const detected = detectAdapters(cwd);
    expect(detected.some((a) => a.id === "codex")).toBe(false);
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

  it("generic is never auto-detected", async () => {
    const cwd = await makeTempDir();
    // Create all known folders \u2014 generic should still not be detected
    await mkdir(join(cwd, ".claude"), { recursive: true });
    await mkdir(join(cwd, ".cursor"), { recursive: true });
    await mkdir(join(cwd, ".agents"), { recursive: true });
    await mkdir(join(cwd, ".clinerules"), { recursive: true });
    const detected = detectAdapters(cwd);
    expect(detected.some((a) => a.id === "generic")).toBe(false);
  });
});

// -- explainAgentDetection -----------------------------------------------------

describe("explainAgentDetection", () => {
  it("returns entries for all adapters except generic", () => {
    const { entries } = explainAgentDetection(tmpdir(), "test-proj");
    const ids = entries.map((e) => e.id);
    expect(ids).toContain("claude");
    expect(ids).toContain("cursor");
    expect(ids).toContain("codex");
    expect(ids).toContain("windsurf");
    expect(ids).toContain("antigravity");
    expect(ids).toContain("cline");
    expect(ids).not.toContain("generic");
  });

  it("every entry has required fields", () => {
    const { entries } = explainAgentDetection(tmpdir(), "my-project");
    for (const entry of entries) {
      expect(entry).toHaveProperty("id");
      expect(entry).toHaveProperty("label");
      expect(entry).toHaveProperty("detected");
      expect(entry).toHaveProperty("selected");
      expect(entry).toHaveProperty("detectionSignals");
      expect(entry).toHaveProperty("outputKind");
      expect(entry).toHaveProperty("workspacePath");
      expect(entry).toHaveProperty("resolvedOutput");
      expect(entry).toHaveProperty("officialDocsUrl");
      expect(typeof entry.id).toBe("string");
      expect(typeof entry.label).toBe("string");
      expect(typeof entry.detected).toBe("boolean");
      expect(typeof entry.selected).toBe("boolean");
      expect(Array.isArray(entry.detectionSignals)).toBe(true);
      expect(typeof entry.outputKind).toBe("string");
      expect(typeof entry.workspacePath).toBe("string");
      expect(typeof entry.resolvedOutput).toBe("string");
      expect(typeof entry.officialDocsUrl).toBe("string");
    }
  });

  it("detectionSignals show correct paths for detected adapters", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, ".claude"), { recursive: true });
    await mkdir(join(cwd, ".clinerules"), { recursive: true });
    await mkdir(join(cwd, ".antigravity"), { recursive: true });

    const { entries } = explainAgentDetection(cwd, "test-proj");

    const claudeEntry = entries.find((e) => e.id === "claude")!;
    expect(claudeEntry.detected).toBe(true);
    expect(claudeEntry.detectionSignals).toContain(".claude/ exists");

    const clineEntry = entries.find((e) => e.id === "cline")!;
    expect(clineEntry.detected).toBe(true);
    expect(clineEntry.detectionSignals).toContain(".clinerules/ exists");

    const antigravityEntry = entries.find((e) => e.id === "antigravity")!;
    expect(antigravityEntry.detected).toBe(true);
    expect(antigravityEntry.detectionSignals).toContain(".antigravity/ exists");

    // Not created \u2014 should not be detected
    const cursorEntry = entries.find((e) => e.id === "cursor")!;
    expect(cursorEntry.detected).toBe(false);
    expect(cursorEntry.detectionSignals).toHaveLength(0);
  });

  it("detectionSignals show .agents/ exists for codex when .agents/ is present", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, ".agents"), { recursive: true });

    const { entries } = explainAgentDetection(cwd, "test-proj");
    const codexEntry = entries.find((e) => e.id === "codex")!;
    expect(codexEntry.detected).toBe(true);
    expect(codexEntry.detectionSignals).toContain(".agents/ exists");
  });

  it("detectionSignals show .codex/ exists for codex when .codex/ is present", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, ".codex"), { recursive: true });

    const { entries } = explainAgentDetection(cwd, "test-proj");
    const codexEntry = entries.find((e) => e.id === "codex")!;
    expect(codexEntry.detected).toBe(true);
    expect(codexEntry.detectionSignals).toContain(".codex/ exists");
  });

  it("detectionSignals show .agent/ exists for antigravity when .agent/ is present", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, ".agent"), { recursive: true });

    const { entries } = explainAgentDetection(cwd, "test-proj");
    const antigravityEntry = entries.find((e) => e.id === "antigravity")!;
    expect(antigravityEntry.detected).toBe(true);
    expect(antigravityEntry.detectionSignals).toContain(".agent/ exists");
  });

  it("generic is excluded from explainAgentDetection entries", () => {
    const { entries } = explainAgentDetection(tmpdir(), "test-proj");
    expect(entries.some((e) => e.id === "generic")).toBe(false);
  });

  it("defaultSelection is detected adapters when any are found", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, ".claude"), { recursive: true });
    await mkdir(join(cwd, ".cursor"), { recursive: true });

    const { defaultSelection } = explainAgentDetection(cwd, "test-proj");
    expect(defaultSelection).toContain("claude");
    expect(defaultSelection).toContain("cursor");
    // Not detected, should not be in defaultSelection
    expect(defaultSelection).not.toContain("windsurf");
  });

  it("defaultSelection falls back to [claude, generic] when nothing detected", () => {
    const { defaultSelection } = explainAgentDetection(tmpdir(), "test-proj");
    expect(defaultSelection).toEqual(["claude", "generic"]);
  });

  it("selected flag matches defaultSelection", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, ".claude"), { recursive: true });

    const { entries, defaultSelection } = explainAgentDetection(cwd, "test-proj");
    const selectedSet = new Set(defaultSelection);

    for (const entry of entries) {
      expect(entry.selected).toBe(selectedSet.has(entry.id));
    }
  });

  it("resolvedOutput matches adapter official paths", () => {
    const { entries } = explainAgentDetection(tmpdir(), "my-project");

    const claude = entries.find((e) => e.id === "claude")!;
    expect(claude.resolvedOutput).toContain(".claude/skills/my-project-best-practices/");
    expect(claude.resolvedOutput).toContain("SKILL.md");

    const cursor = entries.find((e) => e.id === "cursor")!;
    expect(cursor.resolvedOutput).toBe(".cursor/rules/my-project-best-practices.mdc");

    const codex = entries.find((e) => e.id === "codex")!;
    expect(codex.resolvedOutput).toContain(".agents/skills/my-project-codex-best-practices/");
    expect(codex.resolvedOutput).toContain("SKILL.md");

    const windsurf = entries.find((e) => e.id === "windsurf")!;
    expect(windsurf.resolvedOutput).toBe(".windsurf/rules/my-project-best-practices.md");

    const antigravity = entries.find((e) => e.id === "antigravity")!;
    expect(antigravity.resolvedOutput).toContain(
      ".agents/skills/my-project-antigravity-best-practices/",
    );
    expect(antigravity.resolvedOutput).toContain("SKILL.md");

    const cline = entries.find((e) => e.id === "cline")!;
    expect(cline.resolvedOutput).toBe(".clinerules/my-project-best-practices.md");
  });
});

// -- CLI: create-skills --explain-agents ---------------------------------------

describe("create-skills --explain-agents CLI", () => {
  it("--format json outputs valid JSON without --agent or --all-agents", async () => {
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
        createSkillsValues({
          "all-agents": false,
          "create-skills-format": "json",
          "create-skills-force": false,
          "skip-index-refresh": false,
          "explain-agents": true,
        }),
        cwd,
      );
      expect(exitCode).toBe(0);
      expect(captured).not.toBeNull();
      const parsed = JSON.parse(captured!);
      expect(parsed).toHaveProperty("projectName");
      expect(parsed).toHaveProperty("defaultSelection");
      expect(parsed).toHaveProperty("agents");
      expect(Array.isArray(parsed.agents)).toBe(true);
      expect(parsed.agents.length).toBeGreaterThan(0);
    } finally {
      console.log = originalLog;
    }
  });

  it("JSON output agents array entries have all required fields", async () => {
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
      await runCreateSkillsCommand(
        createSkillsValues({
          "all-agents": false,
          "create-skills-format": "json",
          "create-skills-force": false,
          "skip-index-refresh": false,
          "explain-agents": true,
        }),
        cwd,
      );

      const parsed = JSON.parse(captured!);
      const agent = parsed.agents[0];
      expect(agent).toHaveProperty("id");
      expect(agent).toHaveProperty("label");
      expect(agent).toHaveProperty("detected");
      expect(agent).toHaveProperty("selected");
      expect(agent).toHaveProperty("detectionSignals");
      expect(agent).toHaveProperty("outputKind");
      expect(agent).toHaveProperty("workspacePath");
      expect(agent).toHaveProperty("resolvedOutput");
      expect(agent).toHaveProperty("officialDocsUrl");
    } finally {
      console.log = originalLog;
    }
  });

  it("does NOT create or refresh .mp-sentinel-cache/", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);

    await runCreateSkillsCommand(
      createSkillsValues({
        "all-agents": false,
        "create-skills-format": undefined,
        "create-skills-force": false,
        "skip-index-refresh": false,
        "explain-agents": true,
      }),
      cwd,
    );

    expect(existsSync(join(cwd, ".mp-sentinel-cache"))).toBe(false);
  });

  it("does NOT write generated skill files", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);

    await runCreateSkillsCommand(
      createSkillsValues({
        "all-agents": true,
        "create-skills-format": undefined,
        "create-skills-force": false,
        "skip-index-refresh": false,
        "explain-agents": true,
      }),
      cwd,
    );

    // None of the adapter output directories should exist
    for (const adapter of ADAPTER_REGISTRY.filter((a) => a.id !== "generic")) {
      const spec = adapter.spec;
      const resolved = spec.workspacePath.replace(/\{projectName\}/g, "fixture");
      // Get the top-level directory from the resolved path
      const topDir = resolved.split("/")[0]!;
      if (topDir && topDir.startsWith(".")) {
        // Agent-specific directories should not be created
        const fullPath = join(cwd, topDir);
        if (existsSync(fullPath)) {
          // If the dir exists, it shouldn't contain generated skill files
          // (but could exist from other sources, so we check for generated content)
        }
      }
    }
    // Stronger check: no generated skill files with metadata marker
    expect(existsSync(join(cwd, ".claude", "skills"))).toBe(false);
    expect(existsSync(join(cwd, ".cursor", "rules"))).toBe(false);
    expect(existsSync(join(cwd, ".agents", "skills"))).toBe(false);
    expect(existsSync(join(cwd, ".agents", "rules"))).toBe(false);
    expect(existsSync(join(cwd, ".windsurf", "rules"))).toBe(false);
    expect(existsSync(join(cwd, ".clinerules"))).toBe(false);
  });

  it("exit code is always 0", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);

    // Console mode
    const ec1 = await runCreateSkillsCommand(
      createSkillsValues({
        "all-agents": false,
        "create-skills-format": undefined,
        "create-skills-force": false,
        "skip-index-refresh": false,
        "explain-agents": true,
      }),
      cwd,
    );
    expect(ec1).toBe(0);

    // JSON mode
    const ec2 = await runCreateSkillsCommand(
      createSkillsValues({
        "all-agents": false,
        "create-skills-format": "json",
        "create-skills-force": false,
        "skip-index-refresh": false,
        "explain-agents": true,
      }),
      cwd,
    );
    expect(ec2).toBe(0);
  });

  it("JSON output has projectName from package.json", async () => {
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
      await runCreateSkillsCommand(
        createSkillsValues({
          "all-agents": false,
          "create-skills-format": "json",
          "create-skills-force": false,
          "skip-index-refresh": false,
          "explain-agents": true,
        }),
        cwd,
      );
      const parsed = JSON.parse(captured!);
      expect(parsed.projectName).toBe("fixture");
    } finally {
      console.log = originalLog;
    }
  });

  it("works even without package.json (projectName falls back to 'project')", async () => {
    const cwd = await makeTempDir();
    // No package.json \u2014 just a bare directory

    let captured: string | null = null;
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      if (text.trim().startsWith("{")) captured = text;
      originalLog?.(...args);
    };

    try {
      const exitCode = await runCreateSkillsCommand(
        createSkillsValues({
          "all-agents": false,
          "create-skills-format": "json",
          "create-skills-force": false,
          "skip-index-refresh": false,
          "explain-agents": true,
        }),
        cwd,
      );
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(captured!);
      expect(parsed.projectName).toBe("project");
    } finally {
      console.log = originalLog;
    }
  });

  it("defaultSelection reflects detected agents in a real project directory", async () => {
    const cwd = await makeTempDir();
    await makeMinimalProject(cwd);
    await mkdir(join(cwd, ".claude"), { recursive: true });
    await mkdir(join(cwd, ".cursor"), { recursive: true });

    let captured: string | null = null;
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      if (text.trim().startsWith("{")) captured = text;
      originalLog?.(...args);
    };

    try {
      await runCreateSkillsCommand(
        createSkillsValues({
          "all-agents": false,
          "create-skills-format": "json",
          "create-skills-force": false,
          "skip-index-refresh": false,
          "explain-agents": true,
        }),
        cwd,
      );
      const parsed = JSON.parse(captured!);
      expect(parsed.defaultSelection).toContain("claude");
      expect(parsed.defaultSelection).toContain("cursor");
      expect(parsed.defaultSelection).not.toContain("windsurf");

      // Check that selected flags on agents match defaultSelection
      const claudeEntry = parsed.agents.find((e: ExplainAgentEntry) => e.id === "claude");
      expect(claudeEntry.selected).toBe(true);
      const windsurfEntry = parsed.agents.find((e: ExplainAgentEntry) => e.id === "windsurf");
      expect(windsurfEntry.selected).toBe(false);
    } finally {
      console.log = originalLog;
    }
  });
});
