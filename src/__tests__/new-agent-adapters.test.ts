/**
 * Tests for the Phase 4.2 agent adapters (aider, continue, roo, copilot,
 * zed, jetbrains). Each is registered, has a non-empty spec with an
 * officialDocsUrl, and detects from the right signals.
 */

import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";
import {
  ADAPTER_REGISTRY,
  detectAdapters,
  explainAgentDetection,
} from "../services/skills-generator/registry.js";

describe("Phase 4.2 — adapter registration", () => {
  const newIds = ["aider", "continue", "roo", "copilot", "zed", "jetbrains"];

  it.each(newIds)("registers the %s adapter", (id) => {
    expect(ADAPTER_REGISTRY.some((a) => a.id === id)).toBe(true);
  });

  it.each(newIds)("%s adapter has an officialDocsUrl", (id) => {
    const a = ADAPTER_REGISTRY.find((x) => x.id === id);
    expect(a).toBeDefined();
    expect(a?.spec.officialDocsUrl).toMatch(/^https?:\/\//);
  });

  it("registry is generic-last (existing invariant)", () => {
    const last = ADAPTER_REGISTRY[ADAPTER_REGISTRY.length - 1];
    expect(last?.id).toBe("generic");
  });
});

describe("Phase 4.2 — adapter detection", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "mp-sentinel-adapters-"));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("detects aider via .aider.conf.yml", async () => {
    await writeFile(join(tmp, ".aider.conf.yml"), "auto-commits: false\n");
    const found = detectAdapters(tmp).map((a) => a.id);
    expect(found).toContain("aider");
  });

  it("detects continue via .continue/", async () => {
    await mkdir(join(tmp, ".continue"), { recursive: true });
    expect(detectAdapters(tmp).map((a) => a.id)).toContain("continue");
  });

  it("detects roo via .roo/", async () => {
    await mkdir(join(tmp, ".roo"), { recursive: true });
    expect(detectAdapters(tmp).map((a) => a.id)).toContain("roo");
  });

  it("detects copilot via .github/copilot-instructions.md", async () => {
    await mkdir(join(tmp, ".github"), { recursive: true });
    await writeFile(join(tmp, ".github", "copilot-instructions.md"), "# rules\n");
    expect(detectAdapters(tmp).map((a) => a.id)).toContain("copilot");
  });

  it("detects zed via .zed/", async () => {
    await mkdir(join(tmp, ".zed"), { recursive: true });
    expect(detectAdapters(tmp).map((a) => a.id)).toContain("zed");
  });

  it("detects jetbrains via .junie/", async () => {
    await mkdir(join(tmp, ".junie"), { recursive: true });
    expect(detectAdapters(tmp).map((a) => a.id)).toContain("jetbrains");
  });

  it("explainAgentDetection includes the new adapters with detection signals", async () => {
    await mkdir(join(tmp, ".roo"), { recursive: true });
    const { entries } = explainAgentDetection(tmp, "my-project");
    const roo = entries.find((e) => e.id === "roo");
    expect(roo).toBeDefined();
    expect(roo?.detected).toBe(true);
    expect(roo?.detectionSignals).toContain(".roo/ exists");
  });
});

describe("Phase 4.2 — adapter output paths", () => {
  it("writes to expected canonical paths", () => {
    const root = "/tmp/proj";
    const find = (id: string) => ADAPTER_REGISTRY.find((a) => a.id === id);
    expect(find("aider")?.getDefaultOutput(root, "demo")).toBe(`${root}/CONVENTIONS.md`);
    expect(find("continue")?.getDefaultOutput(root, "demo")).toBe(
      `${root}/.continue/rules/demo-best-practices.md`,
    );
    expect(find("roo")?.getDefaultOutput(root, "demo")).toBe(
      `${root}/.roo/skills/demo-roo-best-practices`,
    );
    expect(find("copilot")?.getDefaultOutput(root, "demo")).toBe(
      `${root}/.github/copilot-instructions.md`,
    );
    expect(find("zed")?.getDefaultOutput(root, "demo")).toBe(
      `${root}/.agents/skills/demo-zed-best-practices`,
    );
    expect(find("jetbrains")?.getDefaultOutput(root, "demo")).toBe(`${root}/.junie/AGENTS.md`);
  });
});
