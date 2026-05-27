#!/usr/bin/env -S npx tsx
/**
 * Generate the JSON Schema for `.mp-sentinelrc.json` from the live Zod
 * schemas in src/utils/config.ts.
 *
 * Run via `npm run schema:gen`. CI (release:check) can detect drift by
 * running this and asserting `git diff --exit-code schemas/`.
 *
 * The output file is shipped with the package so users get IDE
 * autocomplete (VSCode + JetBrains) by referencing
 *   "$schema": "./node_modules/mp-sentinel/schemas/mp-sentinelrc.schema.json"
 * (or the GitHub raw URL) at the top of their config.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ProjectConfigSchema } from "../src/utils/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUTPUT_PATH = resolve(REPO_ROOT, "schemas", "mp-sentinelrc.schema.json");

const schema = z.toJSONSchema(ProjectConfigSchema, {
  target: "draft-2020-12",
  reused: "inline",
});

// Decorate with $id / title / description so editors show useful UI.
const decorated = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://github.com/peter-minhnn/mp-sentinel/schemas/mp-sentinelrc.schema.json",
  title: "MP Sentinel project configuration",
  description:
    "Schema for .mp-sentinelrc.json — controls reviews, indexing, create-skills, and MCP integration.",
  ...schema,
};

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(decorated, null, 2) + "\n");

process.stdout.write(`Wrote ${OUTPUT_PATH}\n`);
