/**
 * Manifest reader unit tests — verifies Python, Go, and Rust reader output.
 * Each fixture is a real directory with the ecosystem's manifest file.
 */

import { afterEach, describe, it, expect } from "@jest/globals";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readManifest,
  detectReader,
  detectEcosystem,
} from "../services/source-index/manifests/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");
const REPO_ROOT = join(__dirname, "..", "..");

// ── Python reader ─────────────────────────────────────────────────────────

describe("python reader", () => {
  const root = join(FIXTURES, "python-only");

  it("detects Python project", () => {
    expect(detectReader(root).id).toBe("python");
  });

  it("returns ecosystem 'python'", () => {
    expect(detectEcosystem(root)).toBe("python");
  });

  it("reads pyproject.toml metadata", async () => {
    const manifest = await readManifest(root);
    expect(manifest.packageName).toBe("python-fixture");
    expect(manifest.packageVersion).toBe("1.0.0");
    expect(manifest.ecosystem).toBe("python");
    expect(manifest.packageManager).toBe("pip");
  });

  it("extracts dependencies from pyproject.toml", async () => {
    const manifest = await readManifest(root);
    expect(manifest.dependencies).toHaveProperty("fastapi");
    expect(manifest.dependencies).toHaveProperty("pydantic");
    expect(manifest.dependencies).toHaveProperty("sqlalchemy");
  });

  it("extracts dev dependencies from optional-dependencies", async () => {
    const manifest = await readManifest(root);
    expect(manifest.devDependencies).toHaveProperty("pytest");
  });

  it("detects Python frameworks", async () => {
    const manifest = await readManifest(root);
    expect(manifest.detectedFrameworks).toContain("fastapi");
    expect(manifest.detectedFrameworks).toContain("sqlalchemy");
  });

  it("extracts scripts from [project.scripts]", async () => {
    const manifest = await readManifest(root);
    expect(manifest.scripts).toHaveProperty("run-server");
  });
});

// ── Go reader ─────────────────────────────────────────────────────────────

describe("go reader", () => {
  const root = join(FIXTURES, "go-only");

  it("detects Go project", () => {
    expect(detectReader(root).id).toBe("go");
  });

  it("returns ecosystem 'go'", () => {
    expect(detectEcosystem(root)).toBe("go");
  });

  it("reads go.mod metadata", async () => {
    const manifest = await readManifest(root);
    expect(manifest.packageName).toBe("github.com/example/go-fixture");
    expect(manifest.packageVersion).toBe("1.22");
    expect(manifest.ecosystem).toBe("go");
    expect(manifest.packageManager).toBe("go-mod");
  });

  it("extracts dependencies from go.mod", async () => {
    const manifest = await readManifest(root);
    expect(manifest.dependencies).toHaveProperty(["github.com/gin-gonic/gin"]);
    expect(manifest.dependencies).toHaveProperty(["github.com/spf13/cobra"]);
    expect(manifest.dependencies).toHaveProperty(["golang.org/x/text"]);
  });

  it("detects Go frameworks", async () => {
    const manifest = await readManifest(root);
    expect(manifest.detectedFrameworks).toContain("gin");
    expect(manifest.detectedFrameworks).toContain("cobra");
  });
});

// ── Rust reader ───────────────────────────────────────────────────────────

describe("rust reader", () => {
  const root = join(FIXTURES, "rust-only");

  it("detects Rust project", () => {
    expect(detectReader(root).id).toBe("rust");
  });

  it("returns ecosystem 'rust'", () => {
    expect(detectEcosystem(root)).toBe("rust");
  });

  it("reads Cargo.toml metadata", async () => {
    const manifest = await readManifest(root);
    expect(manifest.packageName).toBe("rust-fixture");
    expect(manifest.packageVersion).toBe("0.1.0");
    expect(manifest.ecosystem).toBe("rust");
    expect(manifest.packageManager).toBe("cargo");
  });

  it("extracts dependencies from Cargo.toml", async () => {
    const manifest = await readManifest(root);
    expect(manifest.dependencies).toHaveProperty("tokio");
    expect(manifest.dependencies).toHaveProperty("axum");
    expect(manifest.dependencies).toHaveProperty("serde");
    expect(manifest.dependencies).toHaveProperty("clap");
    expect(manifest.devDependencies).toHaveProperty("tokio-test");
  });

  it("detects Rust frameworks", async () => {
    const manifest = await readManifest(root);
    expect(manifest.detectedFrameworks).toContain("axum");
    expect(manifest.detectedFrameworks).toContain("tokio");
    expect(manifest.detectedFrameworks).toContain("serde");
    expect(manifest.detectedFrameworks).toContain("clap");
  });
});

// ── Node reader (regression) ──────────────────────────────────────────────

describe("node reader (regression)", () => {
  it("detects Node project", () => {
    expect(detectReader(REPO_ROOT).id).toBe("node");
  });

  it("returns ecosystem 'node'", async () => {
    expect(detectEcosystem(REPO_ROOT)).toBe("node");
  });

  it("reads package.json name correctly", async () => {
    const manifest = await readManifest(REPO_ROOT);
    expect(manifest.packageName).toBe("mp-sentinel");
    expect(manifest.ecosystem).toBe("node");
  });

  it("detects NestJS from scoped @nestjs/* deps (no bare `nestjs` package exists)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mp-nest-"));
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({
          name: "nest-app",
          dependencies: { "@nestjs/core": "^9.0.0", "@nestjs/common": "^9.0.0" },
          devDependencies: { typescript: "^5.0.0", jest: "^29.0.0" },
        }),
      );
      const manifest = await readManifest(dir);
      expect(manifest.detectedFrameworks).toContain("nestjs");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── Workspace detection ─────────────────────────────────────────────────────

describe("node reader workspace detection", () => {
  const tempDirs: string[] = [];
  const makeRepo = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "mp-ws-"));
    tempDirs.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("reads package.json workspaces as an explicit signal (no package needed)", async () => {
    const dir = makeRepo();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
    );
    const manifest = await readManifest(dir);
    expect(manifest.workspaces).toEqual(["packages/*"]);
  });

  it("parses ONLY the packages: list from pnpm-workspace.yaml", async () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "root" }));
    // Non-package YAML lists must be ignored
    writeFileSync(
      join(dir, "pnpm-workspace.yaml"),
      [
        "packages:",
        "  - packages/*",
        "  - apps/web",
        "onlyBuiltDependencies:",
        "  - esbuild",
        "  - '@scope/native'",
        "catalog:",
        "  - some-pkg",
      ].join("\n"),
    );
    mkdirSync(join(dir, "packages", "core"), { recursive: true });
    writeFileSync(
      join(dir, "packages", "core", "package.json"),
      JSON.stringify({ name: "@mono/core", scripts: { build: "tsc" } }),
    );
    const manifest = await readManifest(dir);
    expect(manifest.workspaces).toEqual(["packages/*", "apps/web"]);
    expect(manifest.workspaces).not.toContain("esbuild");
    expect(manifest.workspaces).not.toContain("some-pkg");
    expect(manifest.workspacePackages?.map((p) => p.name)).toContain("@mono/core");
  });

  it("does not claim a monorepo from pnpm-workspace.yaml with no real package", async () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "root" }));
    writeFileSync(join(dir, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
    // No package.json under packages/*
    const manifest = await readManifest(dir);
    expect(manifest.workspaces).toBeUndefined();
    expect(manifest.workspacePackages).toBeUndefined();
  });

  it("never emits '.' as a workspace token", async () => {
    const dir = makeRepo();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "root", workspaces: [".", "packages/*"] }),
    );
    const manifest = await readManifest(dir);
    expect(manifest.workspaces).toEqual(["packages/*"]);
  });
});
