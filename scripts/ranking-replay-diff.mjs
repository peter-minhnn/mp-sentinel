#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { compareReplay } from "./lib/ranking-replay-diff.mjs";

const [before, after, arm = "anchored"] = process.argv.slice(2);
try {
  if (!before || !after)
    throw new Error("usage: ranking-replay-diff.mjs BEFORE AFTER [anchored|plain]");
  const read = (path) => JSON.parse(readFileSync(path, "utf8"));
  const report = compareReplay(read(before), read(after), arm);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  // Regression remains actionable even when net retention improves.
  process.exitCode = report.regressed > 0 ? 1 : 0;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
