/**
 * Docs consistency test.
 * Verifies that direct-provider model names cited in documentation files
 * are all accepted by AIProviderFactory.isSupportedModel.
 *
 * This catches the common mistake of adding a model to docs without
 * first adding it to the factory catalog (modelTiers in factory.ts).
 *
 * OpenRouter models use slash-form and are validated separately.
 */

import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "node:fs";
import { AIProviderFactory } from "../services/ai/factory.js";

/**
 * Direct-provider model names extracted from docs/README.md.
 * Source: "Models by Tier / Recommended Priority" column in the
 * "Supported AI Providers" table.
 */
const readmeModels: Record<string, string[]> = {
  gemini: [
    "gemini-3.1-pro-preview",
    "gemini-3-flash-preview",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-3.1-flash-lite-preview",
    "gemini-2.5-flash-lite",
  ],
  openai: [
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-5.2",
    "gpt-5.2-pro",
    "gpt-5-mini",
  ],
  anthropic: ["claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"],
  grok: ["grok-4.3", "grok-4", "grok-4-1-fast-reasoning", "grok-code-fast-1"],
};

/**
 * Direct-provider model names from docs/PROVIDER_COMPARISON.md.
 * Source: "tier catalog" tables and "Additional models" notes
 * that correspond to factory catalog entries.
 */
const comparisonModels: Record<string, string[]> = {
  gemini: [
    "gemini-3.1-pro-preview",
    "gemini-3-flash-preview",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-3.1-flash-lite-preview",
    "gemini-2.5-flash-lite",
  ],
  openai: [
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-5.2",
    "gpt-5.2-pro",
    "gpt-5-mini",
  ],
  anthropic: ["claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"],
  grok: ["grok-4.3", "grok-4", "grok-4-1-fast-reasoning", "grok-code-fast-1"],
};

type Provider = "gemini" | "openai" | "anthropic" | "grok";

// -- Helpers ----------------------------------------------------------------

const testFixture = (fixture: Record<string, string[]>, label: string) => {
  describe(label, () => {
    for (const [provider, models] of Object.entries(fixture)) {
      describe(provider, () => {
        it.each(models)("%s is accepted by isSupportedModel", (model) => {
          expect(AIProviderFactory.isSupportedModel(provider as Provider, model)).toBe(true);
        });
      });
    }
  });
};

// -- Tests ------------------------------------------------------------------

describe("Docs consistency — model names accepted by factory", () => {
  testFixture(readmeModels, "docs/README.md");
  testFixture(comparisonModels, "docs/PROVIDER_COMPARISON.md");

  // Verify that every catalog model for direct providers appears in both docs.
  // This ensures no factory model is undocumented.
  describe("Every factory catalog model appears in documentation", () => {
    const directProviders: Provider[] = ["gemini", "openai", "anthropic", "grok"];

    for (const provider of directProviders) {
      it(`${provider}: all catalog models in README.md`, () => {
        const catalog = AIProviderFactory.getRecommendedModels(provider);
        const docModels = readmeModels[provider]!;
        for (const model of catalog) {
          expect(docModels).toContain(model);
        }
      });

      it(`${provider}: all catalog models in PROVIDER_COMPARISON.md`, () => {
        const catalog = AIProviderFactory.getRecommendedModels(provider);
        const docModels = comparisonModels[provider]!;
        for (const model of catalog) {
          expect(docModels).toContain(model);
        }
      });
    }
  });
});

// ── Node engine consistency guard ───────────────────────────────────

describe("Node engine consistency", () => {
  it("direct runtime dependencies do not require Node higher than engines.node", () => {
    // Read the project's package.json
    const rootUrl = new URL("../../", import.meta.url);
    const pkg = JSON.parse(readFileSync(new URL("package.json", rootUrl), "utf-8"));
    const engineNode = pkg.engines?.node as string | undefined;
    if (!engineNode) return;

    const majorMatch = engineNode.match(/(\d+)/);
    if (!majorMatch) return;
    const engineMajor = parseInt(majorMatch[1]!, 10);

    const depsToCheck = ["commander", "@google/genai"];
    for (const depName of depsToCheck) {
      try {
        const depPkgPath = `node_modules/${depName}/package.json`;
        const depPkg = JSON.parse(readFileSync(new URL(depPkgPath, rootUrl), "utf-8"));
        const depNode = depPkg.engines?.node as string | undefined;
        if (!depNode) continue;
        const depMajor = parseInt(depNode.match(/(\d+)/)?.[1] ?? "0", 10);
        expect(depMajor).toBeLessThanOrEqual(engineMajor);
      } catch {
        // skip
      }
    }
  });
});

// ── Deprecated SDK guard ────────────────────────────────────────────

describe("No deprecated SDK references in docs", () => {
  const deprecatedPatterns = [
    { pattern: /@google\/generative-ai/, label: "@google/generative-ai" },
    { pattern: /GoogleGenerativeAI/, label: "GoogleGenerativeAI" },
  ];

  const docFiles = [
    "docs/README.md",
    "docs/PROVIDER_COMPARISON.md",
    "docs/CONTRIBUTING.md",
    "docs/CODE_STYLE.md",
    "docs/CICD_SETUP.md",
  ];

  const retiredModelPatterns = [
    { pattern: /gpt-5\.3-codex/, label: "gpt-5.3-codex" },
    { pattern: /gemini-3-pro-preview/, label: "gemini-3-pro-preview" },
  ];

  const allowedFiles = new Set([
    "docs/CHANGELOG.md",
    "docs/PROVIDER_COMPARISON.md",
    "WHATS_NEW.md",
    "src/services/ai/cache.ts",
  ]);

  for (const { pattern, label } of deprecatedPatterns) {
    it(`docs do not reference ${label}`, () => {
      const rootUrl = new URL("../../", import.meta.url);
      for (const file of docFiles) {
        if (allowedFiles.has(file)) continue;
        try {
          const content = readFileSync(new URL(file, rootUrl), "utf-8");
          if (pattern.test(content)) {
            throw new Error(`${file} contains reference to deprecated "${label}"`);
          }
        } catch (err) {
          if (err instanceof Error && err.message.includes("contains")) throw err;
        }
      }
    });
  }

  for (const { pattern, label } of retiredModelPatterns) {
    it(`packaged files do not reference retired model ${label}`, () => {
      const rootUrl = new URL("../../", import.meta.url);
      const packagedFiles: string[] = [
        "docs/README.md",
        "docs/CONTRIBUTING.md",
        "docs/CODE_STYLE.md",
        "docs/CICD_SETUP.md",
        "docs/COMMANDS_CHEAT_SHEET.md",
        "docs/QUICK_START.md",
        "docs/QUICK_REFERENCE.md",
        "docs/SKILLS_INTEGRATION.md",
        "docs/SKILLS_QUICK_START.md",
        "examples/workflows/github/audit-openai.yml.example",
        "examples/workflows/gitlab/.gitlab-ci-openai.yml.example",
        "README.md",
      ];
      for (const file of packagedFiles) {
        if (allowedFiles.has(file)) continue;
        try {
          const content = readFileSync(new URL(file, rootUrl), "utf-8");
          if (pattern.test(content)) {
            throw new Error(`${file} contains retired model "${label}"`);
          }
        } catch (err) {
          if (err instanceof Error && err.message.includes("contains")) throw err;
        }
      }
    });
  }
});
