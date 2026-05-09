#!/usr/bin/env node

/**
 * SvelteKit smoke test - validates that create-skills produces
 * Svelte-aware output for a real SvelteKit-shaped project.
 *
 * Creates a temp SvelteKit fixture at runtime (no checked-in cache),
 * runs `mp-sentinel indexing` and `create-skills --no-ai-enrich`,
 * then asserts:
 *   - language-patterns.md includes a "svelte" row with count > 0
 *   - code-style.md has a real profile (not the "No code style profile" fallback)
 *   - SKILL.md ## Language & Framework Rules mentions Svelte
 *
 * Exit codes:
 *   0 - all assertions pass
 *   1 - one or more assertions fail
 *   2 - script/runtime error
 */

import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BIN = `node ${join(ROOT, "dist", "index.js")}`;
const FIXTURE_NAME = "svelte-smoke";

function fail(msg) {
  process.stderr.write(`FAIL: ${msg}\n`);
  process.exitCode = 1;
}

// --- create temp fixture -------------------------------------------------

const tmpDir = mkdtempSync(join(tmpdir(), "mp-sentinel-svelte-smoke-"));

try {
  mkdirSync(join(tmpDir, "src", "routes"), { recursive: true });
  mkdirSync(join(tmpDir, "src", "lib"), { recursive: true });

  writeFileSync(
    join(tmpDir, "package.json"),
    JSON.stringify({
      name: FIXTURE_NAME,
      version: "1.0.0",
      private: true,
      type: "module",
      scripts: { dev: "vite dev", build: "vite build" },
      dependencies: { svelte: "^5.0.0", "@sveltejs/kit": "^2.0.0" },
    }),
  );

  writeFileSync(
    join(tmpDir, "src", "routes", "+page.svelte"),
    `<script lang="ts">
  import { onMount } from "svelte";
  import { base } from "$app/paths";
  let count = \$state(0);
  function handleClick() { count++; }
<\/script>

<main>
  <h1>Hello</h1>
  <button on:click={handleClick}>{count}</button>
</main>`,
  );

  writeFileSync(
    join(tmpDir, "src", "lib", "store.ts"),
    'export function hello() { return "hello from svelte"; }\n',
  );

  // --- step 1: index & verify --------------------------------------------

  process.stdout.write("[svelte-smoke] Building source index...\n");
  execSync(`${BIN} indexing --force`, { cwd: tmpDir, stdio: "pipe", timeout: 60000 });

  const indexRaw = execSync(`${BIN} indexing --force --index-format json 2>/dev/null`, {
    cwd: tmpDir,
    encoding: "utf-8",
    timeout: 60000,
  });

  let index;
  try {
    index = JSON.parse(indexRaw);
  } catch {
    process.stderr.write("SMOKE ERROR: indexing JSON output is not valid JSON\n");
    process.exit(2);
  }

  const svelteFiles = index.files?.filter?.((f) => f.path.endsWith(".svelte")) ?? [];
  if (svelteFiles.length === 0) {
    fail("no .svelte files found in source index");
  } else {
    process.stdout.write(`[svelte-smoke] Indexed ${svelteFiles.length} .svelte file(s)\n`);
  }

  // --- step 2: create skills ---------------------------------------------

  process.stdout.write("[svelte-smoke] Generating skills...\n");
  const skillDir = join(tmpDir, ".claude", "skills", `${FIXTURE_NAME}-best-practices`);

  execSync(`${BIN} create-skills --all-agents --force --no-ai-enrich 2>/dev/null`, {
    cwd: tmpDir,
    stdio: "pipe",
    timeout: 120000,
  });

  // --- step 3: verify reference files ------------------------------------

  const refDir = join(skillDir, "references");

  // 3a. language-patterns.md has a svelte row
  const langPatterns = readFileSync(join(refDir, "language-patterns.md"), "utf-8");
  const hasSvelteRow = /svelte\s*\|/i.test(langPatterns);
  if (!hasSvelteRow) {
    fail("language-patterns.md does not contain a Svelte row");
  } else {
    process.stdout.write("[svelte-smoke] language-patterns.md has Svelte row: OK\n");
  }

  // 3b. code-style.md has a real profile
  const codeStyle = readFileSync(join(refDir, "code-style.md"), "utf-8");
  if (codeStyle.includes("No code style profile available")) {
    fail("code-style.md shows the 'No code style profile available' fallback");
  } else {
    process.stdout.write("[svelte-smoke] code-style.md has a real profile: OK\n");
  }

  // 3c. SKILL.md mentions Svelte in Language & Framework Rules
  const skillMd = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
  const langSection = skillMd.match(/## Language & Framework Rules([\s\S]*?)(?=## |$)/i);
  if (!langSection || !langSection[1]?.toLowerCase().includes("svelte")) {
    fail("SKILL.md Language & Framework Rules section does not mention Svelte");
  } else {
    process.stdout.write("[svelte-smoke] SKILL.md mentions Svelte: OK\n");
  }

  // --- cleanup -----------------------------------------------------------

  rmSync(tmpDir, { recursive: true, force: true });

  if (process.exitCode) {
    process.stdout.write("[svelte-smoke] Some checks failed.\n");
    process.exit(process.exitCode);
  }

  process.stdout.write("[svelte-smoke] All checks passed.\n");
  process.exit(0);
} catch (e) {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
  const msg = e.stderr ? String(e.stderr).trim() : (e.message || String(e));
  process.stderr.write(`SMOKE ERROR: ${msg}\n`);
  process.exit(2);
}
