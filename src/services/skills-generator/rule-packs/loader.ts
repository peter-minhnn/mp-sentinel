/**
 * Rule-pack loader — loads user-supplied rule packs from JSON and TypeScript files.
 *
 * Security: .json packs are validated with Zod. .ts packs are loaded via
 * dynamic import() — only load .ts packs from trusted directories that you
 * control (e.g. your project's rules/ directory). mp-sentinel never downloads
 * packs from external sources.
 *
 * Composition: packs can extend built-in packs via extends.from + override,
 * and can disable built-in rules via extends.disable.
 */

import { z } from "zod";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import type { CreateSkillsRulePacksConfig } from "../../../types/index.js";
import { ALL_PACKS } from "./index.js";
import type { RulePack, RulePackRule } from "./index.js";

// ── Zod schema for JSON rule packs ──────────────────────────────────────────

const RulePackRuleSchema = z.object({
  kind: z.enum(["must", "should", "avoid"]),
  text: z.string().min(1),
});

const RulePackSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9_-]+$/, "Pack ID must be lowercase alphanumeric"),
  label: z.string().min(1),
  rules: z.array(RulePackRuleSchema).min(1),
  fileGlobs: z.array(z.string()),
});

const UserRulePackConfigSchema = z.object({
  rulePacks: z.array(RulePackSchema),
});

// ── Loader ─────────────────────────────────────────────────────────────────

export interface LoadedRulePack {
  pack: RulePack;
  source: string;
}

/**
 * Load user-supplied rule packs from the project config.
 * Returns both the loaded packs and the set of built-in pack IDs to exclude.
 */
export async function loadUserRulePacks(
  projectRoot: string,
  config: CreateSkillsRulePacksConfig | undefined,
): Promise<{
  packs: LoadedRulePack[];
  exclude: Set<string>;
  overrideDefs: NonNullable<CreateSkillsRulePacksConfig["extends"]>;
}> {
  const result: LoadedRulePack[] = [];
  const exclude = new Set(config?.exclude ?? []);
  const overrideDefs = config?.extends ?? [];

  if (!config?.include || config.include.length === 0) {
    return { packs: result, exclude, overrideDefs };
  }

  for (const includePath of config.include) {
    const absPath = join(projectRoot, includePath);
    const ext = extname(absPath).toLowerCase();

    if (ext === ".json") {
      const pack = await loadJsonPack(absPath);
      if (pack) {
        result.push({ pack, source: includePath });
      }
    } else if (ext === ".ts") {
      const pack = await loadTsPack(absPath);
      if (pack) {
        result.push({ pack, source: includePath });
      }
    }
    // Skip unsupported extensions
  }

  return { packs: result, exclude, overrideDefs };
}

/**
 * Load a rule pack from a JSON file.
 */
async function loadJsonPack(absPath: string): Promise<RulePack | null> {
  let raw: string;
  try {
    raw = await readFile(absPath, "utf-8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  // Support both { rulePacks: [...] } and a single pack object
  let packs: z.infer<typeof RulePackSchema>[];
  const singleResult = RulePackSchema.safeParse(parsed);
  if (singleResult.success) {
    packs = [singleResult.data];
  } else {
    const multiResult = UserRulePackConfigSchema.safeParse(parsed);
    if (!multiResult.success) return null;
    packs = multiResult.data.rulePacks;
  }

  // Convert Zod-validated packs to RulePack type
  // For JSON packs, evaluators cannot be specified (they are code)
  for (const p of packs) {
    return {
      id: p.id,
      label: p.label,
      when: () => true, // User-supplied packs are always active
      rules: p.rules.map((r) => ({
        kind: r.kind as RulePackRule["kind"],
        text: r.text,
      })),
      fileGlobs: p.fileGlobs,
    };
  }

  return null;
}

/**
 * Load a rule pack from a TypeScript file.
 * Dynamically imports the file, expecting it to export a `rulePack: RulePack`.
 *
 * SECURITY: Only import .ts files from trusted directories you control.
 * The file is loaded in-process with full access to the Node.js runtime.
 */
async function loadTsPack(absPath: string): Promise<RulePack | null> {
  try {
    const mod = await import(absPath);
    if (mod.rulePack && typeof mod.rulePack === "object" && mod.rulePack.id) {
      return mod.rulePack as RulePack;
    }
  } catch {
    // Silently skip unloadable packs
  }
  return null;
}

/**
 * Apply composition overrides to the built-in ALL_PACKS array.
 * Returns a new array with exclusions and overrides applied.
 */
export function applyPackOverrides(
  packs: RulePack[],
  exclude: Set<string>,
  extendsDefs: Array<{
    from: string;
    override?: Array<{ id: string; severity?: string }>;
    disable?: string[];
  }>,
): RulePack[] {
  const result = packs.filter((p) => !exclude.has(p.id));

  // Reset override tracking for each extends def
  for (const def of extendsDefs) {
    const pack = result.find((p) => p.id === def.from);
    if (!pack) continue;

    if (def.disable && def.disable.length > 0) {
      const disabledSet = new Set(def.disable);
      pack.rules = pack.rules.filter((r) => !disabledSet.has(r.text));
    }

    if (def.override && def.override.length > 0) {
      for (const ov of def.override) {
        // Override by matching the rule text prefix (rule IDs are text-based)
        const rule = pack.rules.find((r) => r.text.startsWith(ov.id.split("/").pop() ?? ov.id));
        if (rule && ov.severity) {
          rule.kind = ov.severity as RulePackRule["kind"];
        }
      }
    }
  }

  return result;
}
