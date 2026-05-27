/**
 * Smoke tests for the shipped JSON Schema (`schemas/mp-sentinelrc.schema.json`).
 *
 * We don't run a full JSON Schema validator here — the goal is to prevent
 * regressions where the file gets accidentally deleted, mangled, or stops
 * matching the example config's shape. Heavy validation is done by editor
 * tooling (VS Code, JetBrains) against the file at edit time.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@jest/globals";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const SCHEMA_PATH = resolve(REPO_ROOT, "schemas", "mp-sentinelrc.schema.json");
const EXAMPLE_PATH = resolve(REPO_ROOT, ".mp-sentinelrc.example.json");

describe("schemas/mp-sentinelrc.schema.json", () => {
  it("is valid JSON", async () => {
    const text = await readFile(SCHEMA_PATH, "utf-8");
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it("declares a Draft 2020-12 $schema and a stable $id", async () => {
    const schema = JSON.parse(await readFile(SCHEMA_PATH, "utf-8")) as Record<string, unknown>;
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(typeof schema.$id).toBe("string");
    expect(schema.title).toBeDefined();
  });

  it("describes every top-level field used in the example config", async () => {
    const schema = JSON.parse(await readFile(SCHEMA_PATH, "utf-8")) as {
      properties: Record<string, unknown>;
    };
    const example = JSON.parse(await readFile(EXAMPLE_PATH, "utf-8")) as Record<string, unknown>;

    for (const key of Object.keys(example)) {
      // The $schema field is meta — it doesn't need to be in properties.
      if (key === "$schema") continue;
      expect(schema.properties).toHaveProperty(key);
    }
  });

  it("references the schema file from the example config", async () => {
    const example = JSON.parse(await readFile(EXAMPLE_PATH, "utf-8")) as Record<string, unknown>;
    expect(typeof example.$schema).toBe("string");
    expect(example.$schema).toMatch(/mp-sentinelrc\.schema\.json$/);
  });
});
