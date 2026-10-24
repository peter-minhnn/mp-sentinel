import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

describe("identifier evidence experiment fixtures", () => {
  it("runs the shared definition, composition, chain and end-to-end fixtures", () => {
    const fixtures = [
      "identifier-evidence.test.mjs",
      "coherent-seed.test.mjs",
      "selected-chain.test.mjs",
      "identifier-benchmark.test.mjs",
      "anchor-coverage-guard.test.mjs",
      "coverage-decision.test.mjs",
    ].map((name) => resolve("scripts/lib", name));
    const result = spawnSync(process.execPath, ["--test", ...fixtures], {
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (result.status !== 0) {
      throw new Error(
        `Identifier fixtures failed (${String(result.status)}): ${result.error?.message ?? ""}\n${result.stdout}\n${result.stderr}`,
      );
    }
  });
});
