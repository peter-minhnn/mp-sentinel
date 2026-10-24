#!/usr/bin/env node
/** Benchmark tool outputs only. Run tuning first, then evaluate its frozen choice. */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { checkCorpus } from "./lib/golden-lock.mjs";
import {
  ALLOCATIONS,
  createQuery,
  fingerprint,
  hash,
  measureRow,
  selectAllocation,
  summarize,
  validateRows,
} from "./lib/allocation-bench.mjs";

const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function toolFingerprint(cli) {
  const paths = [
    "scripts/agent-allocation-benchmark.mjs",
    "scripts/lib/allocation-bench.mjs",
    "scripts/agent-chain-benchmark.mjs",
    "scripts/lib/chain-metrics.mjs",
  ];
  return {
    revision: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: TOOL_ROOT,
      encoding: "utf8",
    }).trim(),
    cliSha256: hash(readFileSync(cli)),
    experimentSha256: hash(
      paths.map((path) => readFileSync(join(TOOL_ROOT, path), "utf8")).join("\n"),
    ),
  };
}

function measureConfiguration(config, slice, records, query) {
  const measured = slice.map((row) => measureRow(row, config, records, query));
  process.stderr.write(`allocation ${config.id}: ${measured.length} rows measured\n`);
  return {
    config,
    summary: summarize(measured),
    slices: Object.fromEntries(
      ["tuning", "validation", "held-out"].map((name) => [
        name,
        summarize(measured.filter((row) => row.slice === name)),
      ]),
    ),
    rows: measured,
  };
}

export function frozenConfigurations(values, identity, report) {
  if (values.phase === "tuning") return ALLOCATIONS;
  if (!values.selection) throw new Error("evaluation requires --selection tuning-report.json");
  const selection = JSON.parse(readFileSync(resolve(values.selection), "utf8"));
  if (
    selection.phase !== "tuning" ||
    (values.phase !== "replay" && JSON.stringify(selection.tool) !== JSON.stringify(identity.tool))
  )
    throw new Error("selection tool fingerprint mismatch");
  if (
    values.phase === "evaluate" &&
    (JSON.stringify(selection.corpus) !== JSON.stringify(identity.corpus) ||
      JSON.stringify(selection.index) !== JSON.stringify(identity.index))
  )
    throw new Error("selection corpus/index fingerprint mismatch");
  if (values.phase === "transfer" && selection.corpus.sha256 === identity.corpus.sha256)
    throw new Error("transfer requires a different corpus");
  if (selection.selected !== selectAllocation(selection.runs))
    throw new Error("invalid frozen selection");
  for (const run of selection.runs) {
    const current = ALLOCATIONS.find((config) => config.id === run.config.id);
    if (JSON.stringify(current) !== JSON.stringify(run.config))
      throw new Error("frozen allocation changed");
  }
  report.selected = selection.selected;
  report.selectionOrigin = {
    corpus: selection.corpus,
    index: selection.index,
    tool: selection.tool,
  };
  return ALLOCATIONS.filter(
    (config) => config.id === "baseline" || config.id === selection.selected,
  );
}

function main() {
  const { values } = parseArgs({
    options: {
      repo: { type: "string", default: TOOL_ROOT },
      corpus: { type: "string", default: join(TOOL_ROOT, "scripts/chain-golden.json") },
      phase: { type: "string", default: "tuning" },
      selection: { type: "string" },
      output: { type: "string" },
    },
  });
  if (!["tuning", "evaluate", "transfer", "replay"].includes(values.phase))
    throw new Error("phase must be tuning/evaluate/transfer/replay");
  const root = resolve(values.repo);
  const goldenPath = resolve(values.corpus);
  const corpus = checkCorpus({
    id: "allocation",
    goldenPath,
    lockPath: goldenPath.replace(/\.json$/, ".lock.json"),
  });
  if (!corpus.ok) throw new Error(corpus.reason);
  const cli = join(TOOL_ROOT, "dist/index.js");
  const before = fingerprint(root);
  const tool = toolFingerprint(cli);
  const identity = {
    corpus: { version: corpus.lock.version, ...corpus.actual },
    index: before,
    tool,
  };
  const rows = JSON.parse(readFileSync(goldenPath, "utf8"));
  const core = JSON.parse(readFileSync(join(root, ".mp-sentinel-cache/source-index.json"), "utf8"));
  const records = new Map(core.files.map((file) => [file.path, file]));
  validateRows(rows, records);
  const query = createQuery(cli, root);
  const report = {
    ...identity,
    phase: values.phase,
    tokenScope: "compact JSON tool bodies, excluding request/model/conversation/protocol tokens",
    latencyScope:
      "one sequential CLI chain per row and arm; descriptive across tasks, excludes diagnostic call",
    runs: [],
  };
  const configurations = frozenConfigurations(values, identity, report);
  for (const config of configurations) {
    const slice = rows.filter(
      (row) =>
        values.phase === "replay" ||
        (values.phase === "tuning"
          ? !row.validation && !row.heldOut
          : row.validation || row.heldOut),
    );
    if (!slice.length) throw new Error(`no rows for phase ${values.phase}`);
    report.runs.push(measureConfiguration(config, slice, records, query));
    if (JSON.stringify(fingerprint(root)) !== JSON.stringify(before))
      throw new Error("repo/index changed during measurement");
  }
  if (values.phase === "tuning") report.selected = selectAllocation(report.runs);
  if (JSON.stringify(fingerprint(root)) !== JSON.stringify(before))
    throw new Error("repo/index changed during measurement");
  if (JSON.stringify(toolFingerprint(cli)) !== JSON.stringify(tool))
    throw new Error("experiment code changed during measurement");
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (values.output) writeFileSync(resolve(values.output), text);
  else process.stdout.write(text);
  process.stderr.write(`selected=${report.selected}; production defaults unchanged\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`FAIL allocation: ${error.message}\n`);
    process.exitCode = error.exitCode ?? 2;
  }
}
