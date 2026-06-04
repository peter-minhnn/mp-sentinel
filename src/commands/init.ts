/**
 * `init` command (Phase 4.5) -- guided setup for `.mp-sentinelrc.json`.
 *
 * Goal: lower onboarding friction. New users today copy
 * `.mp-sentinelrc.example.json` and edit by hand. This command:
 *   1. Detects the project's tech stack (via existing tech-profile service).
 *   2. Proposes a sensible default config keyed on what was detected
 *      (provider + tier, severity threshold, MCP presets if env supports them,
 *      skills-fetch, modelTier).
 *   3. Prompts interactively (using the existing `prompts` dep) -- every
 *      prompt has a defaulted answer that maps directly to the proposal.
 *   4. Writes the file. Refuses to overwrite without `--force`.
 *   5. Prints the suggested next step (`create-skills --all-agents --dry-run`)
 *      -- it does not run that preview automatically.
 *
 * Test contract: when `--non-interactive` or `MP_SENTINEL_INIT_NONINTERACTIVE=1`
 * is set, the command uses the proposed defaults verbatim and writes the
 * file without prompting. This is what tests exercise.
 *
 * Exit codes:
 *   0 -- wrote the config
 *   1 -- refused to overwrite without --force
 *   2 -- unexpected error
 */

import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import prompts from "prompts";

import type { ProjectConfig, SeverityThreshold } from "../types/index.js";
import type { AIProvider, ModelTier } from "../services/ai/types.js";
import { detectTechProfile } from "../services/tech-profile.js";
import { log } from "../utils/logger.js";

export interface InitCommandValues {
  "init-force"?: boolean;
  "init-non-interactive"?: boolean;
  "init-format"?: "console" | "json";
}

const CONFIG_FILENAME = ".mp-sentinelrc.json";
const SCHEMA_REF = "./schemas/mp-sentinelrc.schema.json";

interface InitProposal {
  provider: AIProvider;
  modelTier: ModelTier;
  severityThreshold: SeverityThreshold;
  enableSkillsFetch: boolean;
  enableMcpGithub: boolean;
  enableMcpFilesystem: boolean;
  techStack: string;
  rules: string[];
}

/**
 * Compute the proposed defaults based on the detected tech profile and
 * environment. Pure: no IO except what `detectTechProfile` does.
 */
export const proposeInitDefaults = async (cwd: string): Promise<InitProposal> => {
  const profile = await detectTechProfile({} as ProjectConfig, cwd);
  const techs = profile.technologies.map((t) => t.toLowerCase());

  // Provider preference: Anthropic if ANTHROPIC_API_KEY set, else Gemini
  // (cheapest with free tier), else OpenAI. This matches the fallback chain
  // in `src/services/ai/factory.ts`.
  const provider: AIProvider = process.env["ANTHROPIC_API_KEY"]
    ? "anthropic"
    : process.env["GEMINI_API_KEY"] || process.env["GOOGLE_API_KEY"]
      ? "gemini"
      : process.env["OPENAI_API_KEY"]
        ? "openai"
        : "gemini";

  // Tier: balanced is the documented default and matches existing example.
  const modelTier: ModelTier = "balanced";

  // Severity: WARNING is the historical default -- preserve unless the user
  // is on a service profile where stricter gating typically wins.
  const severityThreshold: SeverityThreshold =
    profile.profile === "node-service" ? "CRITICAL" : "WARNING";

  const enableMcpGithub = Boolean(process.env["GITHUB_TOKEN"]);
  const enableMcpFilesystem = false; // off by default -- requires explicit user opt-in

  const rules = buildDefaultRules(techs);
  const techStack = profile.technologies.slice(0, 8).join(", ");

  return {
    provider,
    modelTier,
    severityThreshold,
    enableSkillsFetch: true,
    enableMcpGithub,
    enableMcpFilesystem,
    techStack,
    rules,
  };
};

/**
 * Build a minimal starter rule list keyed on detected technologies. We keep
 * this conservative -- broad rules from the example config that apply to most
 * TS/Node projects, plus a couple of stack-specific reminders when relevant.
 */
const buildDefaultRules = (technologies: string[]): string[] => {
  const techSet = new Set(technologies);
  const rules: string[] = [];

  if (techSet.has("typescript")) {
    rules.push(
      "CRITICAL: All internal imports MUST use the '.js' extension for ESM compatibility.",
    );
    rules.push("CRITICAL: Node.js built-in modules MUST use the 'node:' prefix.");
    rules.push("CRITICAL: All public functions and methods MUST have explicit return types.");
  }

  rules.push("PERFORMANCE: Independent tasks MUST use 'Promise.all' for parallel execution.");
  rules.push("CLEAN CODE: Error handling MUST use type guards instead of casting to 'any'.");

  if (techSet.has("react") || techSet.has("next") || techSet.has("nextjs")) {
    rules.push(
      "REACT: useEffect/useMemo/useCallback dependency arrays MUST list every value read inside.",
    );
  }
  if (techSet.has("express") || techSet.has("fastify") || techSet.has("nestjs")) {
    rules.push(
      "SERVICE: Async route handlers MUST have explicit error handling (no unhandled rejections).",
    );
  }
  if (techSet.has("python")) {
    rules.push(
      "PYTHON: Avoid `pickle.loads` and `yaml.load` without `Loader=SafeLoader` on untrusted data.",
    );
  }

  return rules;
};

/**
 * Render the proposal as a JSON config object. The keys mirror
 * `.mp-sentinelrc.example.json` so users can diff and learn the structure.
 */
const renderConfig = (proposal: InitProposal): Record<string, unknown> => {
  const config: Record<string, unknown> = {
    $schema: SCHEMA_REF,
    techStack: proposal.techStack || "TypeScript, Node.js",
    enableSkillsFetch: proposal.enableSkillsFetch,
    rules: proposal.rules,
    maxConcurrency: 5,
    ai: {
      maxFiles: 15,
      maxDiffLines: 1200,
      maxCharsPerFile: 12000,
      modelTier: proposal.modelTier,
    },
    review: {
      severityThreshold: proposal.severityThreshold,
    },
  };

  const mcpPresets: Array<Record<string, unknown>> = [];
  if (proposal.enableMcpGithub) {
    mcpPresets.push({ preset: "github" });
  }
  if (proposal.enableMcpFilesystem) {
    mcpPresets.push({ preset: "filesystem" });
  }
  if (mcpPresets.length > 0) {
    config["mcp"] = { presets: mcpPresets };
  }

  return config;
};

/**
 * Interactive prompt flow. Returns the user-confirmed proposal. When
 * non-interactive, returns the proposal unchanged.
 */
const promptForConfirmation = async (
  proposal: InitProposal,
  nonInteractive: boolean,
): Promise<InitProposal> => {
  if (nonInteractive) return proposal;

  const answers = await prompts(
    [
      {
        type: "select",
        name: "provider",
        message: "Which AI provider should mp-sentinel use?",
        choices: [
          { title: "Anthropic (Claude)", value: "anthropic" },
          { title: "Google (Gemini)", value: "gemini" },
          { title: "OpenAI (GPT)", value: "openai" },
          { title: "xAI (Grok)", value: "grok" },
          { title: "OpenRouter", value: "openrouter" },
        ],
        initial: ["anthropic", "gemini", "openai", "grok", "openrouter"].indexOf(proposal.provider),
      },
      {
        type: "select",
        name: "modelTier",
        message: "Which model tier?",
        choices: [
          { title: "premium  (highest quality)", value: "premium" },
          { title: "balanced (recommended)", value: "balanced" },
          { title: "budget   (cheapest)", value: "budget" },
        ],
        initial: ["premium", "balanced", "budget"].indexOf(proposal.modelTier),
      },
      {
        type: "select",
        name: "severityThreshold",
        message: "Severity threshold (which findings fail the run)?",
        choices: [
          { title: "CRITICAL only", value: "CRITICAL" },
          { title: "WARNING or higher (recommended)", value: "WARNING" },
          { title: "Any finding (INFO+)", value: "INFO" },
        ],
        initial: ["CRITICAL", "WARNING", "INFO"].indexOf(proposal.severityThreshold),
      },
      {
        type: "toggle",
        name: "enableSkillsFetch",
        message: "Enable local skills fetch?",
        initial: proposal.enableSkillsFetch,
        active: "yes",
        inactive: "no",
      },
      ...(process.env["GITHUB_TOKEN"]
        ? [
            {
              type: "toggle" as const,
              name: "enableMcpGithub",
              message: "Enable the GitHub MCP preset (GITHUB_TOKEN detected)?",
              initial: proposal.enableMcpGithub,
              active: "yes",
              inactive: "no",
            },
          ]
        : []),
      {
        type: "toggle",
        name: "enableMcpFilesystem",
        message: "Enable the filesystem MCP preset?",
        initial: proposal.enableMcpFilesystem,
        active: "yes",
        inactive: "no",
      },
    ],
    {
      onCancel: () => {
        throw new Error("init cancelled by user");
      },
    },
  );

  return {
    ...proposal,
    provider: answers["provider"] as AIProvider,
    modelTier: answers["modelTier"] as ModelTier,
    severityThreshold: answers["severityThreshold"] as SeverityThreshold,
    enableSkillsFetch: Boolean(answers["enableSkillsFetch"]),
    enableMcpGithub: Boolean(answers["enableMcpGithub"]),
    enableMcpFilesystem: Boolean(answers["enableMcpFilesystem"]),
  };
};

interface InitJsonResult {
  status: "OK" | "REFUSED" | "ERROR";
  configPath: string;
  written: boolean;
  proposal?: InitProposal;
  message?: string;
}

/**
 * Entry point invoked from `src/index.ts`.
 */
export const runInitCommand = async (
  values: InitCommandValues,
  cwd: string = process.cwd(),
): Promise<number> => {
  const configPath = resolve(cwd, CONFIG_FILENAME);
  const format = values["init-format"] ?? "console";
  const isJson = format === "json";
  const force = Boolean(values["init-force"]);
  const nonInteractive =
    Boolean(values["init-non-interactive"]) ||
    process.env["MP_SENTINEL_INIT_NONINTERACTIVE"] === "1";

  if (existsSync(configPath) && !force) {
    const result: InitJsonResult = {
      status: "REFUSED",
      configPath,
      written: false,
      message: `${CONFIG_FILENAME} already exists. Re-run with --force to overwrite.`,
    };
    if (isJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      log.warning(result.message ?? "");
    }
    return 1;
  }

  const proposal = await proposeInitDefaults(cwd);
  const confirmed = await promptForConfirmation(proposal, nonInteractive);
  const config = renderConfig(confirmed);
  const json = `${JSON.stringify(config, null, 2)}\n`;

  await writeFile(configPath, json, "utf-8");

  const result: InitJsonResult = {
    status: "OK",
    configPath,
    written: true,
    proposal: confirmed,
  };

  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    log.success(`Wrote ${CONFIG_FILENAME}`);
    log.info(`  Provider: ${confirmed.provider} (${confirmed.modelTier})`);
    log.info(`  Severity threshold: ${confirmed.severityThreshold}`);
    if (confirmed.enableMcpGithub) {
      log.info(`  MCP: github preset enabled`);
    }
    log.info(
      `Next step: run 'npx mp-sentinel create-skills --all-agents --dry-run' to preview agent skills.`,
    );
  }

  return 0;
};
