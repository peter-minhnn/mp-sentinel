#!/usr/bin/env node

/**
 * Dogfood validation - runs the core local workflow end-to-end without network calls.
 *
 * Steps:
 *   1. release:check        - version consistency + lockfile integrity
 *   2. build                - tsup compile
 *   3. indexing --stats     - source index build + stats (JSON)
 *   4. indexing --health    - positive health check (status=ok, version fields) (JSON)
 *   5. parser drilldown     - --recovered and --parse-errors drilldown (JSON)
 *   6. index queries        - agent-context, find-symbol, find-import (JSON)
 *   7. create-skills --dry-run - all adapters, no writes + quality gate (JSON)
 *   8. --explain-agents     - agent detection diagnostics (JSON)
 *   9. --explain-context    - context diagnostics (JSON, unavailable path)
 *  10. --explain-context    - context diagnostics (JSON, available path w/ temp fixture)
 *  11. create-skills --doctor - doctor diagnostics (JSON)
 *  12. stale docs check     - no v1.0.x references in docs/
 *  13. agent:skills:check   - generated skills freshness gate
 *
 * Usage:
 *   node scripts/dogfood.mjs
 *   npm run dogfood
 *
 * Exit: 0 = all steps passed, 1 = one or more steps failed, 2 = script error.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// --- helpers -----------------------------------------------------------

const TOTAL_STEPS = 13;
const STEP_INDENT = "  ";

function fail(step, detail) {
  process.stderr.write(`\n${STEP_INDENT}FAIL  ${step}`);
  if (detail) process.stderr.write(` - ${detail}`);
  process.stderr.write("\n");
  process.exitCode = 1;
}

function ok(step, detail) {
  process.stdout.write(`${STEP_INDENT}PASS  ${step}`);
  if (detail) process.stdout.write(` - ${detail}`);
  process.stdout.write("\n");
}

function run(cmd, label, opts) {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 120000, stdio: "pipe", ...opts });
  } catch (e) {
    fail(label, e.stderr?.trim() || e.message);
    return null;
  }
}

function parseJson(raw, label) {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    fail(label, "output is not valid JSON");
    return null;
  }
}

function stepHeader(n, label) {
  process.stdout.write(`\n[${n}/${TOTAL_STEPS}] ${label}\n`);
}

// --- steps -------------------------------------------------------------

function stepReleaseCheck() {
  stepHeader(1, "release:check");
  const out = run("npm run release:check --silent", "release:check");
  if (out === null) return false;

  // release:check writes PASS/FAIL lines to stdout; a trailing newline
  // means the last check printed something.  Exit code tells us the result.
  ok("release:check", "all version + lockfile checks passed");
  return true;
}

function stepBuild() {
  stepHeader(2, "build");
  const out = run("npm run build --silent", "build");
  if (out === null) return false;

  if (!existsSync("dist/index.js")) {
    fail("build", "dist/index.js missing after build");
    return false;
  }
  if (!existsSync("dist/lib.js")) {
    fail("build", "dist/lib.js missing after build");
    return false;
  }

  ok("build", "dist/index.js + dist/lib.js produced");
  return true;
}

function stepIndexing() {
  stepHeader(3, "indexing --stats");
  const out = run(
    "node dist/index.js indexing --stats --index-format json --force",
    "indexing --stats",
  );
  if (out === null) return false;

  const json = parseJson(out, "indexing --stats");
  if (!json) return false;
  if (typeof json.totalFiles !== "number") {
    fail("indexing --stats", "JSON output missing 'totalFiles' field");
    return false;
  }

  ok(
    "indexing --stats",
    `${json.totalFiles} files, ${json.indexedFiles} indexed, ${json.schemaVersion} schema, ${json.durationMs}ms`,
  );
  return true;
}

function stepHealthCheck() {
  stepHeader(4, "indexing --health (positive check)");
  const out = run(
    "node dist/index.js indexing --health --index-format json",
    "indexing --health",
  );
  if (out === null) return false;

  const json = parseJson(out, "indexing --health");
  if (!json) return false;

  if (json.status !== "ok") {
    fail("indexing --health", `expected status "ok", got "${json.status}"`);
    return false;
  }
  if (typeof json.toolVersion !== "string" || json.toolVersion === "") {
    fail("indexing --health", "toolVersion missing or empty");
    return false;
  }
  if (typeof json.currentToolVersion !== "string" || json.currentToolVersion === "") {
    fail("indexing --health", "currentToolVersion missing or empty");
    return false;
  }
  if (json.toolVersion !== json.currentToolVersion) {
    fail(
      "indexing --health",
      `toolVersion "${json.toolVersion}" !== currentToolVersion "${json.currentToolVersion}"`,
    );
    return false;
  }
  if (typeof json.schemaVersion !== "string" || json.schemaVersion === "") {
    fail("indexing --health", "schemaVersion missing or empty");
    return false;
  }
  if (typeof json.parseErrorRate !== "number") {
    fail("indexing --health", "parseErrorRate is not a number");
    return false;
  }
  if (typeof json.recoveredFiles !== "number") {
    fail("indexing --health", "recoveredFiles missing or not a number");
    return false;
  }
  if (typeof json.parserModeBreakdown !== "object" || json.parserModeBreakdown === null) {
    fail("indexing --health", "parserModeBreakdown missing or not an object");
    return false;
  }
  // Validate parserModeBreakdown has at least tree-sitter; other modes may or may not be present.
  if (typeof json.parserModeBreakdown["tree-sitter"] !== "number") {
    fail("indexing --health", "parserModeBreakdown.tree-sitter missing or not a number");
    return false;
  }

  // v1.26.0: lexical fallback must not occur on this repo's own source code.
  // A non-zero count means Tree-sitter + chunked + ASCII all failed for a file,
  // which indicates a silent regression in parser recovery.
  if (json.parserModeBreakdown["lexical-fallback"] !== 0) {
    fail(
      "indexing --health",
      `lexical-fallback=${json.parserModeBreakdown["lexical-fallback"]}, expected 0`,
    );
    return false;
  }

  // Assert suggestedCommands when parser recovery/errors exist
  const hasRecovered = typeof json.recoveredFiles === "number" && json.recoveredFiles > 0;
  const hasParseErrors = typeof json.parseErrorCount === "number" && json.parseErrorCount > 0;
  if (hasRecovered || hasParseErrors) {
    if (!Array.isArray(json.suggestedCommands) || json.suggestedCommands.length === 0) {
      fail(
        "indexing --health",
        "suggestedCommands missing or empty when parser issues exist",
      );
      return false;
    }
    if (hasRecovered && !json.suggestedCommands.some((c) => c.includes("--recovered"))) {
      fail("indexing --health", "suggestedCommands missing --recovered drilldown");
      return false;
    }
    if (hasParseErrors && !json.suggestedCommands.some((c) => c.includes("--parse-errors"))) {
      fail("indexing --health", "suggestedCommands missing --parse-errors drilldown");
      return false;
    }
  }

  // v1.27.0: assert chunk aggregate telemetry when chunked files exist
  const hasChunkedFiles =
    typeof json.parserModeBreakdown === "object" &&
    json.parserModeBreakdown !== null &&
    typeof json.parserModeBreakdown["chunked-tree-sitter"] === "number" &&
    json.parserModeBreakdown["chunked-tree-sitter"] > 0;
  if (hasChunkedFiles) {
    if (typeof json.chunkedFiles !== "number") {
      fail("indexing --health", "chunkedFiles missing when chunked files exist");
      return false;
    }
    if (typeof json.totalChunks !== "number") {
      fail("indexing --health", "totalChunks missing when chunked files exist");
      return false;
    }
    if (typeof json.totalChunkWarnings !== "number") {
      fail("indexing --health", "totalChunkWarnings missing when chunked files exist");
      return false;
    }
    if (typeof json.totalChunkBoundaryWarnings !== "number") {
      fail(
        "indexing --health",
        "totalChunkBoundaryWarnings missing when chunked files exist",
      );
      return false;
    }
    if (typeof json.totalChunkActionableWarnings !== "number") {
      fail(
        "indexing --health",
        "totalChunkActionableWarnings missing when chunked files exist",
      );
      return false;
    }
    if (json.totalChunkActionableWarnings !== 0) {
      fail(
        "indexing --health",
        `totalChunkActionableWarnings must be 0 (got ${json.totalChunkActionableWarnings})`,
      );
      return false;
    }
    if (typeof json.chunkSize !== "number") {
      fail("indexing --health", "chunkSize missing when chunked files exist");
      return false;
    }
  }

  const parts = [
    `status=ok`,
    `toolVersion=${json.toolVersion}`,
    `schemaVersion=${json.schemaVersion}`,
    `parseErrorRate=${json.parseErrorRate}`,
  ];
  if (typeof json.recoveredFiles === "number") {
    parts.push(`recoveredFiles=${json.recoveredFiles}`);
  }
  if (json.parserModeBreakdown && typeof json.parserModeBreakdown === "object") {
    const bd = Object.entries(json.parserModeBreakdown)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    parts.push(`parserModes: ${bd}`);
  }

  ok("indexing --health", parts.join(", "));
  return true;
}

function stepParserDrilldown() {
  stepHeader(5, "parser drilldown");

  // --recovered drilldown
  const recOut = run(
    "node dist/index.js indexing --recovered --index-format json",
    "parser drilldown --recovered",
  );
  if (recOut === null) return false;

  const recJson = parseJson(recOut, "parser drilldown --recovered");
  if (!recJson) return false;

  if (typeof recJson.status !== "string") {
    fail("parser drilldown --recovered", "missing 'status' field");
    return false;
  }
  if (typeof recJson.totalFiles !== "number") {
    fail("parser drilldown --recovered", "missing 'totalFiles' field");
    return false;
  }
  if (typeof recJson.recoveredFiles !== "number") {
    fail("parser drilldown --recovered", "missing 'recoveredFiles' field");
    return false;
  }
  if (typeof recJson.parserModeBreakdown !== "object" || recJson.parserModeBreakdown === null) {
    fail("parser drilldown --recovered", "missing 'parserModeBreakdown' field");
    return false;
  }
  if (!Array.isArray(recJson.files)) {
    fail("parser drilldown --recovered", "'files' is not an array");
    return false;
  }

  // --parse-errors drilldown
  const peOut = run(
    "node dist/index.js indexing --parse-errors --index-format json",
    "parser drilldown --parse-errors",
  );
  if (peOut === null) return false;

  const peJson = parseJson(peOut, "parser drilldown --parse-errors");
  if (!peJson) return false;

  if (typeof peJson.status !== "string") {
    fail("parser drilldown --parse-errors", "missing 'status' field");
    return false;
  }
  if (typeof peJson.totalFiles !== "number") {
    fail("parser drilldown --parse-errors", "missing 'totalFiles' field");
    return false;
  }
  if (typeof peJson.parseErrorCount !== "number") {
    fail("parser drilldown --parse-errors", "missing 'parseErrorCount' field");
    return false;
  }
  if (!Array.isArray(peJson.files)) {
    fail("parser drilldown --parse-errors", "'files' is not an array");
    return false;
  }

  const parts = [
    `recovered=${recJson.recoveredFiles}`,
    `recoveredFiles:${recJson.files.length}`,
    `parseErrors=${peJson.parseErrorCount}`,
    `parseErrorFiles:${peJson.files.length}`,
  ];
  if (recJson.truncated) parts.push("recovered-truncated");
  if (peJson.truncated) parts.push("parseErrors-truncated");

  // v1.24.0: validate first recovered file has suggestedCommands when files exist
  if (recJson.files.length > 0) {
    const firstFile = recJson.files[0];
    if (!Array.isArray(firstFile.suggestedCommands) || firstFile.suggestedCommands.length === 0) {
      fail("parser drilldown --recovered", "first file missing suggestedCommands");
      return false;
    }
    const hasExplain = firstFile.suggestedCommands.some((cmd) => cmd.includes("--explain-index"));
    const hasAgentCtx = firstFile.suggestedCommands.some((cmd) => cmd.includes("--agent-context"));
    if (!hasExplain || !hasAgentCtx) {
      fail(
        "parser drilldown --recovered",
        "suggestedCommands missing --explain-index or --agent-context",
      );
      return false;
    }
  }
  if (peJson.files.length > 0) {
    const firstFile = peJson.files[0];
    if (!Array.isArray(firstFile.suggestedCommands) || firstFile.suggestedCommands.length === 0) {
      fail("parser drilldown --parse-errors", "first file missing suggestedCommands");
      return false;
    }
  }

  // v1.26.0: validate chunk fields for chunked-tree-sitter recovered files
  for (const file of recJson.files) {
    if (file.parserMode !== "chunked-tree-sitter") continue;

    if (!Array.isArray(file.parseWarnings) || file.parseWarnings.length === 0) {
      fail(
        "parser drilldown --recovered",
        `chunked-tree-sitter file "${file.path}" missing parseWarnings`,
      );
      return false;
    }
    const hasRecoveryNote = file.parseWarnings.some(
      (w) => w.includes("chunked tree-sitter") || w.includes("chunked-tree-sitter"),
    );
    if (!hasRecoveryNote) {
      fail(
        "parser drilldown --recovered",
        `chunked-tree-sitter file "${file.path}" missing chunked recovery indicator in parseWarnings`,
      );
      return false;
    }

    // chunkCount must be >= 2 for a meaningful chunked parse
    if (typeof file.chunkCount !== "number" || file.chunkCount < 2) {
      fail(
        "parser drilldown --recovered",
        `chunked-tree-sitter file "${file.path}" missing or invalid chunkCount (got ${file.chunkCount})`,
      );
      return false;
    }

    // chunkSize must be a positive number
    if (typeof file.chunkSize !== "number" || file.chunkSize <= 0) {
      fail(
        "parser drilldown --recovered",
        `chunked-tree-sitter file "${file.path}" missing or invalid chunkSize (got ${file.chunkSize})`,
      );
      return false;
    }

    // chunkWarningCount must be a number (0+)
    if (typeof file.chunkWarningCount !== "number") {
      fail(
        "parser drilldown --recovered",
        `chunked-tree-sitter file "${file.path}" missing chunkWarningCount`,
      );
      return false;
    }

    // chunkBoundaryWarningCount must be a number (0+)
    if (typeof file.chunkBoundaryWarningCount !== "number") {
      fail(
        "parser drilldown --recovered",
        `chunked-tree-sitter file "${file.path}" missing chunkBoundaryWarningCount`,
      );
      return false;
    }

    // chunkActionableWarningCount must be 0
    if (typeof file.chunkActionableWarningCount !== "number") {
      fail(
        "parser drilldown --recovered",
        `chunked-tree-sitter file "${file.path}" missing chunkActionableWarningCount`,
      );
      return false;
    }
    if (file.chunkActionableWarningCount !== 0) {
      fail(
        "parser drilldown --recovered",
        `chunked-tree-sitter file "${file.path}" has actionable chunk warnings (${file.chunkActionableWarningCount})`,
      );
      return false;
    }

    // Chunked recovery must produce meaningful data (non-zero symbols or imports or exports)
    if (file.symbolCount === 0 && file.importCount === 0 && file.exportCount === 0) {
      fail(
        "parser drilldown --recovered",
        `chunked-tree-sitter file "${file.path}" has zero symbols, imports, and exports`,
      );
      return false;
    }
  }

  ok("parser drilldown", parts.join(", "));
  return true;
}

function stepIndexQuery() {
  stepHeader(6, "index queries");

  // --agent-context
  const acOut = run(
    "node dist/index.js indexing --agent-context src/types/index.ts --index-format json",
    "indexing --agent-context",
  );
  if (acOut === null) return false;

  const acJson = parseJson(acOut, "indexing --agent-context");
  if (!acJson) return false;

  if (!acJson.file || typeof acJson.file !== "object") {
    fail("indexing --agent-context", "JSON output missing 'file' object");
    return false;
  }
  if (typeof acJson.file.path !== "string") {
    fail("indexing --agent-context", "file.path missing or not a string");
    return false;
  }
  if (typeof acJson.file.language !== "string") {
    fail("indexing --agent-context", "file.language missing or not a string");
    return false;
  }
  if (!Array.isArray(acJson.file.symbols)) {
    fail("indexing --agent-context", "file.symbols is not an array");
    return false;
  }
  if (!Array.isArray(acJson.file.imports)) {
    fail("indexing --agent-context", "file.imports is not an array");
    return false;
  }
  if (!Array.isArray(acJson.directImports)) {
    fail("indexing --agent-context", "directImports is not an array");
    return false;
  }
  if (!Array.isArray(acJson.directDependents)) {
    fail("indexing --agent-context", "directDependents is not an array");
    return false;
  }
  if (!Array.isArray(acJson.hubFiles)) {
    fail("indexing --agent-context", "hubFiles is not an array");
    return false;
  }
  if (!Array.isArray(acJson.suggestedCommands)) {
    fail("indexing --agent-context", "suggestedCommands is not an array");
    return false;
  }
  const acSymbols = acJson.file.symbolsTruncated ? `${acJson.file.symbols.length}+` : acJson.file.symbols.length;

  // v1.27.0: agent-context chunk fields
  if (acJson.file.parserMode === "chunked-tree-sitter") {
    if (typeof acJson.file.chunkCount !== "number") {
      fail("indexing --agent-context", "chunkCount missing for chunked-tree-sitter file");
      return false;
    }
    if (typeof acJson.file.chunkSize !== "number") {
      fail("indexing --agent-context", "chunkSize missing for chunked-tree-sitter file");
      return false;
    }
    if (typeof acJson.file.chunkWarningCount !== "number") {
      fail("indexing --agent-context", "chunkWarningCount missing for chunked-tree-sitter file");
      return false;
    }
    if (typeof acJson.file.chunkBoundaryWarningCount !== "number") {
      fail(
        "indexing --agent-context",
        "chunkBoundaryWarningCount missing for chunked-tree-sitter file",
      );
      return false;
    }
    if (
      typeof acJson.file.chunkActionableWarningCount !== "number" ||
      acJson.file.chunkActionableWarningCount !== 0
    ) {
      fail(
        "indexing --agent-context",
        `chunkActionableWarningCount must be 0 for chunked-tree-sitter file (got ${acJson.file.chunkActionableWarningCount})`,
      );
      return false;
    }
  } else {
    if ("chunkCount" in acJson.file) {
      fail("indexing --agent-context", `chunkCount present for non-chunked file (parserMode=${acJson.file.parserMode ?? "tree-sitter"})`);
      return false;
    }
  }

  // --explain-index (v1.27.0: chunk telemetry propagation)
  const eiOut = run(
    "node dist/index.js indexing --explain-index src/types/index.ts --index-format json",
    "indexing --explain-index",
  );
  if (eiOut === null) return false;

  const eiJson = parseJson(eiOut, "indexing --explain-index");
  if (!eiJson) return false;

  if (typeof eiJson.path !== "string") {
    fail("indexing --explain-index", "path missing or not a string");
    return false;
  }
  if (eiJson.parserMode === "chunked-tree-sitter") {
    if (typeof eiJson.chunkCount !== "number") {
      fail("indexing --explain-index", "chunkCount missing for chunked-tree-sitter file");
      return false;
    }
    if (typeof eiJson.chunkSize !== "number") {
      fail("indexing --explain-index", "chunkSize missing for chunked-tree-sitter file");
      return false;
    }
    if (typeof eiJson.chunkWarningCount !== "number") {
      fail("indexing --explain-index", "chunkWarningCount missing for chunked-tree-sitter file");
      return false;
    }
    if (typeof eiJson.chunkBoundaryWarningCount !== "number") {
      fail(
        "indexing --explain-index",
        "chunkBoundaryWarningCount missing for chunked-tree-sitter file",
      );
      return false;
    }
    if (
      typeof eiJson.chunkActionableWarningCount !== "number" ||
      eiJson.chunkActionableWarningCount !== 0
    ) {
      fail(
        "indexing --explain-index",
        `chunkActionableWarningCount must be 0 for chunked-tree-sitter file (got ${eiJson.chunkActionableWarningCount})`,
      );
      return false;
    }
  } else {
    if ("chunkCount" in eiJson) {
      fail("indexing --explain-index", `chunkCount present for non-chunked file (parserMode=${eiJson.parserMode ?? "tree-sitter"})`);
      return false;
    }
  }

  // v1.27.0: when chunked files exist, test agent-context + explain-index against one
  const roOut = run(
    "node dist/index.js indexing --recovered --index-format json",
    "index queries --recovered (for chunk field check)",
  );
  if (roOut !== null) {
    const roJson = parseJson(roOut, "index queries --recovered");
    if (roJson && Array.isArray(roJson.files)) {
      const chunked = roJson.files.filter((f) => f.parserMode === "chunked-tree-sitter");
      if (chunked.length > 0) {
        const chunkedPath = chunked[0].path;

        const acChunked = run(
          `node dist/index.js indexing --agent-context ${chunkedPath} --index-format json`,
          `indexing --agent-context ${chunkedPath}`,
        );
        if (acChunked !== null) {
          const acChunkedJson = parseJson(acChunked, `indexing --agent-context ${chunkedPath}`);
          if (acChunkedJson && acChunkedJson.file) {
            if (typeof acChunkedJson.file.chunkCount !== "number") {
              fail("indexing --agent-context (chunked)", "chunkCount missing for chunked file");
              return false;
            }
            if (typeof acChunkedJson.file.chunkSize !== "number") {
              fail("indexing --agent-context (chunked)", "chunkSize missing for chunked file");
              return false;
            }
            if (typeof acChunkedJson.file.chunkWarningCount !== "number") {
              fail("indexing --agent-context (chunked)", "chunkWarningCount missing for chunked file");
              return false;
            }
            if (typeof acChunkedJson.file.chunkBoundaryWarningCount !== "number") {
              fail(
                "indexing --agent-context (chunked)",
                "chunkBoundaryWarningCount missing for chunked file",
              );
              return false;
            }
            if (
              typeof acChunkedJson.file.chunkActionableWarningCount !== "number" ||
              acChunkedJson.file.chunkActionableWarningCount !== 0
            ) {
              fail(
                "indexing --agent-context (chunked)",
                `chunkActionableWarningCount must be 0 for chunked file (got ${acChunkedJson.file.chunkActionableWarningCount})`,
              );
              return false;
            }
          }
        }

        const eiChunked = run(
          `node dist/index.js indexing --explain-index ${chunkedPath} --index-format json`,
          `indexing --explain-index ${chunkedPath}`,
        );
        if (eiChunked !== null) {
          const eiChunkedJson = parseJson(eiChunked, `indexing --explain-index ${chunkedPath}`);
          if (eiChunkedJson) {
            if (typeof eiChunkedJson.chunkCount !== "number") {
              fail("indexing --explain-index (chunked)", "chunkCount missing for chunked file");
              return false;
            }
            if (typeof eiChunkedJson.chunkSize !== "number") {
              fail("indexing --explain-index (chunked)", "chunkSize missing for chunked file");
              return false;
            }
            if (typeof eiChunkedJson.chunkWarningCount !== "number") {
              fail("indexing --explain-index (chunked)", "chunkWarningCount missing for chunked file");
              return false;
            }
            if (typeof eiChunkedJson.chunkBoundaryWarningCount !== "number") {
              fail(
                "indexing --explain-index (chunked)",
                "chunkBoundaryWarningCount missing for chunked file",
              );
              return false;
            }
            if (
              typeof eiChunkedJson.chunkActionableWarningCount !== "number" ||
              eiChunkedJson.chunkActionableWarningCount !== 0
            ) {
              fail(
                "indexing --explain-index (chunked)",
                `chunkActionableWarningCount must be 0 for chunked file (got ${eiChunkedJson.chunkActionableWarningCount})`,
              );
              return false;
            }
          }
        }
      }
    }
  }

  // --find-symbol
  const fsOut = run(
    "node dist/index.js indexing --find-symbol buildSourceIndex --index-format json",
    "indexing --find-symbol",
  );
  if (fsOut === null) return false;

  const fsJson = parseJson(fsOut, "indexing --find-symbol");
  if (!fsJson) return false;

  if (typeof fsJson.query !== "string") {
    fail("indexing --find-symbol", "JSON output missing 'query' field");
    return false;
  }
  if (!Array.isArray(fsJson.results)) {
    fail("indexing --find-symbol", "results is not an array");
    return false;
  }
  if (fsJson.results.length === 0) {
    fail("indexing --find-symbol", "expected results for 'buildSourceIndex', got 0");
    return false;
  }

  // --find-import
  const fiOut = run(
    "node dist/index.js indexing --find-import zod --index-format json",
    "indexing --find-import",
  );
  if (fiOut === null) return false;

  const fiJson = parseJson(fiOut, "indexing --find-import");
  if (!fiJson) return false;

  if (typeof fiJson.query !== "string") {
    fail("indexing --find-import", "JSON output missing 'query' field");
    return false;
  }
  if (!Array.isArray(fiJson.results)) {
    fail("indexing --find-import", "results is not an array");
    return false;
  }
  if (fiJson.results.length === 0) {
    fail("indexing --find-import", "expected results for 'zod', got 0");
    return false;
  }

  ok(
    "index queries",
    `agent-context ${acSymbols} symbols, find-symbol ${fsJson.results.length} hits, find-import ${fiJson.results.length} hits`,
  );
  return true;
}

function stepCreateSkills() {
  stepHeader(7, "create-skills --dry-run");
  const out = run(
    "node dist/index.js create-skills --all-agents --dry-run --format json",
    "create-skills --dry-run",
  );
  if (out === null) return false;

  const json = parseJson(out, "create-skills --dry-run");
  if (!json) return false;
  if (!Array.isArray(json.dryRun)) {
    fail("create-skills --dry-run", "JSON output missing 'dryRun' array");
    return false;
  }

  let fileCount = 0;
  const actions = {};
  for (const entry of json.dryRun) {
    for (const f of entry.files) {
      fileCount++;
      actions[f.action] = (actions[f.action] || 0) + 1;
    }
  }

  // Quality gate: fail on any adapter quality errors
  let qualityErrors = 0;
  for (const entry of json.dryRun) {
    if (entry.quality && entry.quality.errors > 0) {
      qualityErrors += entry.quality.errors;
      for (const check of entry.quality.checks) {
        if (check.severity === "error") {
          fail("create-skills --dry-run", `[quality:${entry.agent}] ${check.file}: ${check.message}`);
        }
      }
    }
  }
  if (qualityErrors > 0) {
    fail("create-skills --dry-run", `${qualityErrors} quality error(s) across adapters`);
    return false;
  }

  const summary = Object.entries(actions)
    .map(([a, c]) => `${a}=${c}`)
    .join(", ");
  ok("create-skills --dry-run", `${json.dryRun.length} agents, ${fileCount} files: ${summary}`);
  return true;
}

function stepExplainAgents() {
  stepHeader(8, "explain-agents");
  const out = run(
    "node dist/index.js create-skills --explain-agents --format json",
    "explain-agents",
  );
  if (out === null) return false;

  const json = parseJson(out, "explain-agents");
  if (!json) return false;

  // Assert top-level fields
  if (typeof json.projectName !== "string") {
    fail("explain-agents", "JSON output missing 'projectName' field");
    return false;
  }
  if (!Array.isArray(json.defaultSelection)) {
    fail("explain-agents", "JSON output missing or invalid 'defaultSelection' field");
    return false;
  }
  if (!Array.isArray(json.agents)) {
    fail("explain-agents", "JSON output missing 'agents' array");
    return false;
  }

  // Assert each agent has required fields
  const requiredFields = [
    "id",
    "detected",
    "selected",
    "detectionSignals",
    "resolvedOutput",
    "officialDocsUrl",
  ];
  for (const agent of json.agents) {
    for (const field of requiredFields) {
      if (!(field in agent)) {
        fail("explain-agents", `agent '${agent.id ?? "?"}' missing field '${field}'`);
        return false;
      }
    }
    if (typeof agent.detected !== "boolean") {
      fail("explain-agents", `agent '${agent.id}' 'detected' is not boolean`);
      return false;
    }
    if (typeof agent.selected !== "boolean") {
      fail("explain-agents", `agent '${agent.id}' 'selected' is not boolean`);
      return false;
    }
    if (!Array.isArray(agent.detectionSignals)) {
      fail("explain-agents", `agent '${agent.id}' 'detectionSignals' is not array`);
      return false;
    }
  }

  const detected = json.agents.filter((a) => a.detected).map((a) => a.id).join(", ") || "none";
  ok("explain-agents", `${json.agents.length} agents, project=${json.projectName}, default=${json.defaultSelection}, detected=[${detected}]`);
  return true;
}

function stepExplainContext() {
  stepHeader(9, "explain-context");
  const out = run(
    "node dist/index.js --explain-context --format json --files src/commands/create-skills.ts",
    "explain-context",
  );
  if (out === null) return false;

  const json = parseJson(out, "explain-context");
  if (!json) return false;

  if (json.status === "ok") {
    ok("explain-context", `profile=${json.profile}, relatedFiles=${json.relatedFiles?.length ?? 0}`);
    return true;
  }

  if (json.status === "unavailable") {
    if (json.reason && json.reason.includes("indexing.enabled = false")) {
      ok("explain-context", "unavailable (indexing disabled) - expected with default config");
      return true;
    }
    fail("explain-context", `unexpected unavailable reason: ${json.reason}`);
    return false;
  }

  fail("explain-context", `unexpected status: ${json.status}`);
  return false;
}

function stepPositiveExplainContext() {
  stepHeader(10, "explain-context (positive path)");

  const repoRoot = process.cwd();
  const tempDir = mkdtempSync(join(tmpdir(), "dogfood-positive-ec-"));

  try {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "dogfood-positive-test", type: "module", version: "1.0.0" }, null, 2),
      "utf-8",
    );
    writeFileSync(
      join(tempDir, ".mp-sentinelrc.json"),
      JSON.stringify({ indexing: { enabled: true } }, null, 2),
      "utf-8",
    );
    mkdirSync(join(tempDir, "src"), { recursive: true });
    writeFileSync(
      join(tempDir, "src", "api.ts"),
      [
        "export function fetchData(url: string): Promise<Response> {",
        "  return fetch(url);",
        "}",
        "",
        "export class ApiClient {",
        "  constructor(private baseUrl: string) {}",
        "  async get(path: string): Promise<Response> {",
        "    return fetch(this.baseUrl + path);",
        "  }",
        "}",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(tempDir, "src", "lib.ts"),
      [
        "export function formatDate(date: Date): string {",
        "  return date.toISOString();",
        "}",
        "",
        "export function parseQuery(q: string): Record<string, string> {",
        "  const params = new URLSearchParams(q);",
        "  const result: Record<string, string> = {};",
        "  params.forEach((v, k) => {",
        "    result[k] = v;",
        "  });",
        "  return result;",
        "}",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(tempDir, "src", "consumer.ts"),
      [
        'import { fetchData, ApiClient } from "./api";',
        'import { formatDate } from "./lib";',
        "",
        "export async function main(): Promise<unknown> {",
        '  const data = await fetchData("https://example.com");',
        '  const client = new ApiClient("https://api.example.com");',
        '  const result = await client.get("/users");',
        "  const formatted = formatDate(new Date());",
        "  return { data, result, formatted };",
        "}",
      ].join("\n"),
      "utf-8",
    );
    execSync("git init", { encoding: "utf-8", timeout: 30000, stdio: "pipe", cwd: tempDir });

    const indexOut = run(
      `node "${repoRoot}/dist/index.js" indexing --force --index-format json`,
      "positive-explain-context indexing",
      { cwd: tempDir },
    );
    if (indexOut === null) return false;

    const indexJson = parseJson(indexOut, "positive-explain-context indexing");
    if (!indexJson) return false;

    const ecOut = run(
      `node "${repoRoot}/dist/index.js" --explain-context --format json --files src/api.ts`,
      "positive-explain-context",
      { cwd: tempDir },
    );
    if (ecOut === null) return false;

    const ecJson = parseJson(ecOut, "positive-explain-context");
    if (!ecJson) return false;

    if (ecJson.status !== "available") {
      fail(
        "positive-explain-context",
        `expected status "available", got "${ecJson.status}"${ecJson.reason ? `: ${ecJson.reason}` : ""}`,
      );
      return false;
    }
    if (ecJson.indexUsed !== true) {
      fail("positive-explain-context", "indexUsed is not true");
      return false;
    }
    if (!Array.isArray(ecJson.includedFiles) || ecJson.includedFiles.length === 0) {
      fail("positive-explain-context", "includedFiles empty or not an array");
      return false;
    }
    if (!Array.isArray(ecJson.suggestedCommands) || ecJson.suggestedCommands.length === 0) {
      fail("positive-explain-context", "suggestedCommands empty or not an array");
      return false;
    }

    ok(
      "positive-explain-context",
      `status=${ecJson.status}, profile=${ecJson.profile}, ` +
        `includedFiles=${ecJson.includedFiles.length}, suggestedCommands=${ecJson.suggestedCommands.length}`,
    );
    return true;
  } catch (e) {
    fail("positive-explain-context", e.stderr || e.message);
    return false;
  } finally {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  }
}

function stepDoctor() {
  stepHeader(11, "create-skills --doctor");
  let raw;
  try {
    raw = execSync(
      "node dist/index.js create-skills --doctor --format json",
      { encoding: "utf-8", timeout: 120000, stdio: "pipe" },
    );
  } catch (e) {
    // Doctor exits 1 for action-required (e.g. stale skills in dogfood).
    // That's expected; capture its stdout and validate the JSON regardless.
    raw = e.stdout || "";
  }
  if (!raw.trim()) {
    fail("create-skills --doctor", "no output from command");
    return false;
  }

  const json = parseJson(raw, "create-skills --doctor");
  if (!json) return false;

  // Assert top-level fields
  const requiredFields = [
    "status", "projectName", "agents", "index",
    "skills", "legacyFiles", "scripts", "recommendedActions",
    "recommendedCommands",
  ];
  for (const field of requiredFields) {
    if (!(field in json)) {
      fail("create-skills --doctor", `JSON output missing field '${field}'`);
      return false;
    }
  }

  // index should be present since we built it in step 3
  if (!json.index || typeof json.index.status !== "string") {
    fail("create-skills --doctor", "index.status missing or not a string");
    return false;
  }

  // Parser telemetry fields required when index is ok or stale
  if (json.index.status === "ok" || json.index.status === "stale") {
    if (typeof json.index.recoveredFiles !== "number") {
      fail("create-skills --doctor", "index.recoveredFiles missing or not a number");
      return false;
    }
    if (typeof json.index.parserModeBreakdown !== "object" || json.index.parserModeBreakdown === null) {
      fail("create-skills --doctor", "index.parserModeBreakdown missing or not an object");
      return false;
    }
    if (typeof json.index.parseErrorCount !== "number") {
      fail("create-skills --doctor", "index.parseErrorCount missing or not a number");
      return false;
    }

    // v1.28.0: assert chunk aggregate fields when chunked files exist
    const chunkedCount = json.index.parserModeBreakdown?.["chunked-tree-sitter"] ?? 0;
    if (chunkedCount > 0) {
      if (typeof json.index.chunkedFiles !== "number") {
        fail("create-skills --doctor", "index.chunkedFiles missing when chunked files exist");
        return false;
      }
      if (typeof json.index.totalChunks !== "number") {
        fail("create-skills --doctor", "index.totalChunks missing when chunked files exist");
        return false;
      }
      if (typeof json.index.totalChunkWarnings !== "number") {
        fail("create-skills --doctor", "index.totalChunkWarnings missing when chunked files exist");
        return false;
      }
      if (typeof json.index.totalChunkBoundaryWarnings !== "number") {
        fail(
          "create-skills --doctor",
          "index.totalChunkBoundaryWarnings missing when chunked files exist",
        );
        return false;
      }
      if (typeof json.index.totalChunkActionableWarnings !== "number") {
        fail(
          "create-skills --doctor",
          "index.totalChunkActionableWarnings missing when chunked files exist",
        );
        return false;
      }
      if (json.index.totalChunkActionableWarnings !== 0) {
        fail(
          "create-skills --doctor",
          `index.totalChunkActionableWarnings must be 0 (got ${json.index.totalChunkActionableWarnings})`,
        );
        return false;
      }
      if (typeof json.index.chunkSize !== "number") {
        fail("create-skills --doctor", "index.chunkSize missing when chunked files exist");
        return false;
      }
    } else {
      if ("chunkedFiles" in json.index) {
        fail("create-skills --doctor", "index.chunkedFiles present when no chunked files exist");
        return false;
      }
    }
  }

  // skills should include entries for detected adapters
  if (!Array.isArray(json.skills)) {
    fail("create-skills --doctor", "skills is not an array");
    return false;
  }

  // recommendedCommands must be an array of non-empty trimmed strings
  if (!Array.isArray(json.recommendedCommands)) {
    fail("create-skills --doctor", "recommendedCommands is not an array");
    return false;
  }
  for (const cmd of json.recommendedCommands) {
    if (typeof cmd !== "string" || cmd.trim() === "") {
      fail("create-skills --doctor", "recommendedCommands contains non-string or empty entry");
      return false;
    }
  }

  let parserSummary = "";
  if (typeof json.index.recoveredFiles === "number" && typeof json.index.parseErrorCount === "number") {
    parserSummary = `, parser: ${json.index.recoveredFiles} recovered, ${json.index.parseErrorCount} hard errors`;
  }

  ok(
    "create-skills --doctor",
    `status=${json.status}, index=${json.index.status}, ` +
    `skills=${json.skills.length} agents, ${json.legacyFiles?.length ?? 0} legacy, ` +
    `${json.scripts?.length ?? 0} scripts, ${json.recommendedActions?.length ?? 0} actions, ` +
    `${json.recommendedCommands?.length ?? 0} commands${parserSummary}`,
  );
  return true;
}

function stepStaleDocsCheck() {
  stepHeader(12, "stale docs check");

  const DOCS_DIR = "docs";
  if (!existsSync(DOCS_DIR)) {
    ok("stale docs check", "docs/ directory not found -- skipping");
    return true;
  }

  let files;
  try {
    files = readdirSync(DOCS_DIR).filter((f) => f.endsWith(".md"));
  } catch {
    fail("stale docs check", "cannot read docs/ directory");
    return false;
  }

  // Historical files that legitimately reference old versions
  const EXCLUDED = new Set(["CHANGELOG.md"]);
  const STALE_PATTERN = /v1\.0\.\d/;
  // Feature-introduced markers document when a feature first shipped --
  // these are historical context, not stale current-version references.
  const FEATURE_MARKER = /(?:From |\()v1\.0\.\d+[\+\)\,]|pre-v1\.0\.\d+/;

  let staleHits = 0;
  for (const file of files) {
    if (EXCLUDED.has(file)) continue;
    if (file.startsWith("MIGRATION_")) continue;

    let content;
    try {
      content = readFileSync(join(DOCS_DIR, file), "utf-8");
    } catch {
      continue;
    }

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (FEATURE_MARKER.test(lines[i])) continue;
      if (STALE_PATTERN.test(lines[i])) {
        fail("stale docs check", `${DOCS_DIR}/${file}:${i + 1} contains stale v1.0.x reference`);
        staleHits++;
      }
    }
  }

  if (staleHits === 0) {
    ok("stale docs check", "no stale v1.0.x references in docs");
    return true;
  }
  return false;
}

function stepAgentSkillsCheck() {
  stepHeader(13, "agent:skills:check");
  let raw;
  try {
    raw = execSync(
      "npm run agent:skills:check --silent",
      { encoding: "utf-8", timeout: 120000, stdio: "pipe" },
    );
  } catch (e) {
    // Exit 1 = stale/missing/wrong-agent, exit 2 = runtime error. Both fail dogfood.
    const detail =
      e.stdout?.match(/\[agent:skills:check\] (.+)$/m)?.[1]?.trim() ||
      e.stderr?.trim() ||
      `exit code ${e.status}`;
    fail("agent:skills:check", detail);
    return false;
  }

  const detail = raw.match(/\[agent:skills:check\] (.+)$/m)?.[1]?.trim() || "all files up-to-date";
  ok("agent:skills:check", detail);
  return true;
}

// --- main --------------------------------------------------------------

process.stdout.write("\nDogfood validation - mp-sentinel local workflow\n");

const steps = [
  stepReleaseCheck,
  stepBuild,
  stepIndexing,
  stepHealthCheck,
  stepParserDrilldown,
  stepIndexQuery,
  stepCreateSkills,
  stepExplainAgents,
  stepExplainContext,
  stepPositiveExplainContext,
  stepDoctor,
  stepStaleDocsCheck,
  stepAgentSkillsCheck,
];

let passed = 0;
let failed = 0;
for (const step of steps) {
  if (step()) passed++;
  else failed++;
}

process.stdout.write(`\n${passed} passed, ${failed} failed\n\n`);

if (failed > 0) process.exit(1);
