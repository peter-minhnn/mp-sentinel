/**
 * Tests for the `init` command (Phase 4.5).
 *
 * Coverage:
 *   - proposeInitDefaults derives a sensible config from package.json
 *   - runInitCommand writes the config in non-interactive mode
 *   - refuses to overwrite without --force
 *   - JSON output mode reports status correctly
 *   - GITHUB_TOKEN env triggers the github MCP preset proposal
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { proposeInitDefaults, runInitCommand } from "../commands/init.js";
import { clearConfigCache } from "../utils/config.js";

const ENV_KEYS_TO_RESET = [
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENAI_API_KEY",
  "GITHUB_TOKEN",
  "MP_SENTINEL_INIT_NONINTERACTIVE",
];

const savedEnv: Record<string, string | undefined> = {};

const tempDirs: string[] = [];
const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "mp-sentinel-init-"));
  tempDirs.push(dir);
  return dir;
};

beforeEach(() => {
  clearConfigCache();
  for (const key of ENV_KEYS_TO_RESET) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(async () => {
  for (const key of ENV_KEYS_TO_RESET) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

// -- proposeInitDefaults ----------------------------------------------------

describe("proposeInitDefaults", () => {
  it("falls back to gemini provider when no API key env is set", async () => {
    const cwd = await makeTempDir();
    const proposal = await proposeInitDefaults(cwd);
    expect(proposal.provider).toBe("gemini");
    expect(proposal.modelTier).toBe("balanced");
  });

  it("prefers anthropic when ANTHROPIC_API_KEY is set", async () => {
    process.env["ANTHROPIC_API_KEY"] = "sk-ant-test";
    const cwd = await makeTempDir();
    const proposal = await proposeInitDefaults(cwd);
    expect(proposal.provider).toBe("anthropic");
  });

  it("prefers gemini when GEMINI_API_KEY is set", async () => {
    process.env["GEMINI_API_KEY"] = "test";
    const cwd = await makeTempDir();
    const proposal = await proposeInitDefaults(cwd);
    expect(proposal.provider).toBe("gemini");
  });

  it("prefers openai when only OPENAI_API_KEY is set", async () => {
    process.env["OPENAI_API_KEY"] = "sk-test";
    const cwd = await makeTempDir();
    const proposal = await proposeInitDefaults(cwd);
    expect(proposal.provider).toBe("openai");
  });

  it("enables github MCP preset when GITHUB_TOKEN is set", async () => {
    process.env["GITHUB_TOKEN"] = "ghp_test";
    const cwd = await makeTempDir();
    const proposal = await proposeInitDefaults(cwd);
    expect(proposal.enableMcpGithub).toBe(true);
  });

  it("disables github MCP preset when GITHUB_TOKEN is missing", async () => {
    const cwd = await makeTempDir();
    const proposal = await proposeInitDefaults(cwd);
    expect(proposal.enableMcpGithub).toBe(false);
  });

  it("defaults severityThreshold to WARNING for library profile", async () => {
    const cwd = await makeTempDir();
    const proposal = await proposeInitDefaults(cwd);
    expect(proposal.severityThreshold).toBe("WARNING");
  });

  it("derives techStack and rules from package.json deps", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        name: "demo",
        dependencies: { react: "18", next: "14", typescript: "5" },
      }),
    );
    const proposal = await proposeInitDefaults(cwd);
    expect(proposal.techStack.length).toBeGreaterThan(0);
    expect(proposal.rules.some((r) => r.includes("React") || r.includes("REACT"))).toBe(true);
  });
});

// -- runInitCommand: non-interactive ----------------------------------------

describe("runInitCommand (non-interactive)", () => {
  it("writes a valid .mp-sentinelrc.json on first run", async () => {
    const cwd = await makeTempDir();
    process.env["MP_SENTINEL_INIT_NONINTERACTIVE"] = "1";

    const captured: string[] = [];
    const originalLog = console.log;
    console.log = (msg: unknown) => captured.push(String(msg));

    try {
      const code = await runInitCommand({ "init-format": "json" }, cwd);
      expect(code).toBe(0);
    } finally {
      console.log = originalLog;
    }

    const configPath = join(cwd, ".mp-sentinelrc.json");
    expect(existsSync(configPath)).toBe(true);

    const content = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(content) as Record<string, unknown>;
    expect(parsed["$schema"]).toBe("./schemas/mp-sentinelrc.schema.json");
    expect(parsed["ai"]).toBeDefined();
    expect(parsed["review"]).toBeDefined();
  });

  it("refuses to overwrite without --force", async () => {
    const cwd = await makeTempDir();
    process.env["MP_SENTINEL_INIT_NONINTERACTIVE"] = "1";
    const configPath = join(cwd, ".mp-sentinelrc.json");
    await writeFile(configPath, "{}");

    const captured: string[] = [];
    const originalLog = console.log;
    console.log = (msg: unknown) => captured.push(String(msg));

    try {
      const code = await runInitCommand({ "init-format": "json" }, cwd);
      expect(code).toBe(1);

      const result = JSON.parse(captured.join("\n")) as { status: string; written: boolean };
      expect(result.status).toBe("REFUSED");
      expect(result.written).toBe(false);
    } finally {
      console.log = originalLog;
    }

    // Original file unchanged
    const content = await readFile(configPath, "utf-8");
    expect(content).toBe("{}");
  });

  it("overwrites with --force", async () => {
    const cwd = await makeTempDir();
    process.env["MP_SENTINEL_INIT_NONINTERACTIVE"] = "1";
    const configPath = join(cwd, ".mp-sentinelrc.json");
    await writeFile(configPath, "{}");

    const captured: string[] = [];
    const originalLog = console.log;
    console.log = (msg: unknown) => captured.push(String(msg));

    try {
      const code = await runInitCommand({ "init-format": "json", "init-force": true }, cwd);
      expect(code).toBe(0);
    } finally {
      console.log = originalLog;
    }

    const content = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(content) as Record<string, unknown>;
    expect(parsed["$schema"]).toBeDefined();
  });

  it("includes github MCP preset in written config when GITHUB_TOKEN set", async () => {
    process.env["GITHUB_TOKEN"] = "ghp_test";
    process.env["MP_SENTINEL_INIT_NONINTERACTIVE"] = "1";

    const cwd = await makeTempDir();
    const captured: string[] = [];
    const originalLog = console.log;
    console.log = (msg: unknown) => captured.push(String(msg));

    try {
      const code = await runInitCommand({ "init-format": "json" }, cwd);
      expect(code).toBe(0);
    } finally {
      console.log = originalLog;
    }

    const content = await readFile(join(cwd, ".mp-sentinelrc.json"), "utf-8");
    const parsed = JSON.parse(content) as { mcp?: { presets?: Array<{ preset: string }> } };
    expect(parsed.mcp).toBeDefined();
    expect(parsed.mcp?.presets?.some((p) => p.preset === "github")).toBe(true);
  });

  it("written config is valid against the ProjectConfigSchema (Zod parse passes)", async () => {
    const cwd = await makeTempDir();
    process.env["MP_SENTINEL_INIT_NONINTERACTIVE"] = "1";

    const originalLog = console.log;
    console.log = () => {};

    try {
      await runInitCommand({ "init-format": "json" }, cwd);
    } finally {
      console.log = originalLog;
    }

    clearConfigCache();
    const { loadProjectConfig } = await import("../utils/config.js");
    const loaded = await loadProjectConfig(cwd);
    expect(loaded).toBeDefined();
    expect(loaded.review?.severityThreshold).toBeDefined();
  });
});
