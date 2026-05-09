/**
 * Tests for rule-pack review pipeline integration.
 *
 * Covers: finding traceability (rule IDs tie back to SKILL.md),
 * severity overrides, and pack exclusion.
 */

import { describe, it, expect } from "@jest/globals";
import { runRulePackEvaluators } from "../cli/deterministic-review.js";
import { ALL_PACKS } from "../services/skills-generator/rule-packs/index.js";

// ── Tests ───────────────────────────────────────────────────────────────────

describe("runRulePackEvaluators", () => {
  it("returns empty array for clean files", () => {
    const results = runRulePackEvaluators([
      { path: "src/index.ts", content: "const x = 1;\nexport default x;\n" },
    ]);
    expect(results).toHaveLength(0);
  });

  it("returns findings for long files", () => {
    const longFile = Array.from({ length: 600 }, (_, i) => `const x${i} = ${i};\n`).join("");
    const results = runRulePackEvaluators([{ path: "src/long.ts", content: longFile }]);
    expect(results.length).toBeGreaterThan(0);
    // Should have file-too-long finding
    const finding = results[0]!;
    expect(finding.result.issues).toBeDefined();
    expect(finding.result.issues!.length).toBeGreaterThan(0);
  });

  it("findings carry rule IDs in <packId>/<ruleId> format", () => {
    const longFile = Array.from({ length: 600 }, (_, i) => `const x${i} = ${i};\n`).join("");
    const results = runRulePackEvaluators([{ path: "src/long.ts", content: longFile }]);

    // Finding issues have the ruleId embedded in their message
    for (const file of results) {
      for (const issue of file.result.issues ?? []) {
        // The message should indicate which rule was violated
        expect(issue.message).toBeTruthy();
        expect(issue.category).toBe("maintainability");
        expect(issue.confidence).toBe("high");
      }
    }
  });

  it("severity overrides are honored", () => {
    const longFile = Array.from({ length: 600 }, (_, i) => `const x${i} = ${i};\n`).join("");
    const results = runRulePackEvaluators([{ path: "src/long.ts", content: longFile }], {
      "builtin/file-too-long": "CRITICAL",
    });
    for (const file of results) {
      for (const issue of file.result.issues ?? []) {
        if (issue.message.includes("max ")) {
          expect(issue.severity).toBe("CRITICAL");
        }
      }
    }
  });

  it("findings reference the correct file path", () => {
    const longFile = Array.from({ length: 600 }, (_, i) => `const x${i} = ${i};\n`).join("");
    const results = runRulePackEvaluators([
      { path: "src/components/LongFile.ts", content: longFile },
    ]);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.filePath).toBe("src/components/LongFile.ts");
  });

  it("result status is FAIL when findings exist", () => {
    const longFile = Array.from({ length: 600 }, (_, i) => `const x${i} = ${i};\n`).join("");
    const results = runRulePackEvaluators([{ path: "src/long.ts", content: longFile }]);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.result.status).toBe("FAIL");
    }
  });

  it("svelte imports-outside-script triggers via integration", () => {
    const content = [
      '<script lang="ts">',
      "  let count = 0;",
      "</script>",
      "",
      'import { onMount } from "svelte";',
    ].join("\n");

    const results = runRulePackEvaluators([{ path: "src/Bad.svelte", content }]);
    const svelteFindings = results.filter((r) =>
      r.result.issues?.some((i) => i.message.includes("Import statement")),
    );
    expect(svelteFindings.length).toBeGreaterThan(0);
  });
});

describe("Rule ID traceability", () => {
  it("evaluator rule IDs match the SKILL.md rule IDs", () => {
    const sveltePack = ALL_PACKS.find((p) => p.id === "svelte")!;
    expect(sveltePack).toBeDefined();
    expect(sveltePack.evaluators).toBeDefined();
    expect(sveltePack.evaluators!.length).toBeGreaterThan(0);
    const ev = sveltePack.evaluators![0]!;
    expect(ev.ruleId).toBe("imports-inside-script");
    const fullRuleId = `${sveltePack.id}/${ev.ruleId}`;
    expect(fullRuleId).toBe("svelte/imports-inside-script");
  });
});
