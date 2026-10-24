import type { SourceIndex } from "../../types/index.js";
import type { DetectedConvention } from "./convention-detectors.js";

const RUNNERS: ReadonlyArray<readonly [string, string]> = [
  ["node:test", "Node.js node:test"],
  ["vitest", "Vitest"],
  ["@jest/globals", "Jest"],
  ["mocha", "Mocha"],
  ["@playwright/test", "Playwright"],
  ["playwright/test", "Playwright"],
];

/** Placement and runner are independent: installed E2E tooling does not label unit tests. */
export function detectTestConvention(index: SourceIndex): DetectedConvention | null {
  const files = index.files.filter(
    (f) => f.path.includes(".test.") || f.path.includes(".spec.") || f.path.includes("__tests__"),
  );
  if (!files.length) return null;
  const dedicated = files.filter(
    (f) => f.path.includes("__tests__") || /^tests?\//.test(f.path),
  ).length;
  const placement =
    dedicated * 2 >= files.length
      ? "in dedicated test directories (`__tests__/` / `tests/`)"
      : "colocated next to the source files they cover";
  const groups = RUNNERS.flatMap(([source, label]) => {
    const matches = files.filter((f) => f.imports.some((i) => i.source === source));
    return matches.length
      ? [`${label}: ${matches.length} file(s), e.g. \`${matches[0]!.path}\``]
      : [];
  });
  const script = index.project.scripts?.test;
  const command =
    script && /(?:^|\s)node\s.*--test(?:\s|$)/.test(script)
      ? " The test script invokes Node.js --test; do not substitute an E2E runner."
      : "";
  return {
    id: "test-placement",
    text:
      `Tests live ${placement} (${files.length} test file(s)). ` +
      (groups.length
        ? `Runner evidence from imports: ${groups.join("; ")}.`
        : "Runner not established from indexed imports.") +
      command,
  };
}
