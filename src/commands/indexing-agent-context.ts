/**
 * CLI handler for the compact (token-budgeted) `--agent-context` path.
 *
 * Opt-in: the CLI only takes this path when `--token-budget` is given.
 * Without it, `handleAgentContext()` keeps emitting the legacy payload
 * (fixed caps, `suggestedCommands`, no budget) byte-for-byte.
 */

import { log } from "../utils/logger.js";
import { UserError } from "../utils/errors.js";
import type { SourceIndex } from "../types/index.js";
import { emitIndexJson, isIndexJsonPretty } from "../services/source-index/json-output.js";
import {
  buildCompactAgentContext,
  normalizeFocus,
} from "../services/source-index/agent-context-pack.js";
import { handleAgentContext } from "./indexing-queries.js";
import { parseTokenBudgetFlag } from "./indexing-task-context.js";

/**
 * Normalize `--focus` and refuse it outside the compact agent-context path.
 * Called before the index is built so a bad flag fails fast (exit 2).
 */
export function resolveFocusAnchors(values: {
  focus?: string[];
  agentContext?: string;
  tokenBudget?: string;
}): string[] {
  const anchors = normalizeFocus(values.focus);
  if (anchors.length === 0) return anchors;
  if (!values.agentContext) throw new UserError("--focus requires --agent-context");
  if (values.tokenBudget === undefined) {
    throw new UserError("--focus requires --token-budget (compact agent context)");
  }
  return anchors;
}

/**
 * Route `--agent-context`: compact packing is opt-in via `--token-budget`;
 * without it the legacy payload is emitted unchanged.
 */
export async function routeAgentContext(
  filePath: string,
  index: SourceIndex | null,
  format: "console" | "json",
  projectRoot: string,
  options: { tokenBudget?: string; focus: string[] },
): Promise<number> {
  if (options.tokenBudget === undefined) {
    return handleAgentContext(filePath, index, format, projectRoot);
  }
  return handleCompactAgentContext(filePath, index, format, projectRoot, {
    tokenBudget: parseTokenBudgetFlag(options.tokenBudget),
    focus: options.focus,
  });
}

export async function handleCompactAgentContext(
  filePath: string,
  index: SourceIndex | null,
  format: "console" | "json",
  projectRoot: string,
  options: { tokenBudget: number; focus: string[] },
): Promise<number> {
  const pretty = format === "json" && isIndexJsonPretty();
  const ctx = await buildCompactAgentContext(
    index,
    filePath,
    {
      tokenBudget: options.tokenBudget,
      focus: options.focus,
      // `--pretty` whitespace is emitted, so it counts against the budget.
      ...(pretty ? { pretty: true } : {}),
    },
    projectRoot,
  );

  if (ctx.error) {
    if (format === "json") {
      emitIndexJson({ error: ctx.error });
    } else {
      console.log(
        ctx.error === "No index available"
          ? "No index available. Run 'mp-sentinel indexing' first."
          : ctx.error,
      );
    }
    return 1;
  }

  if (format === "json") {
    emitIndexJson(ctx);
    return 0;
  }

  const fileInfo = ctx.file!;
  console.log();
  log.header(`Agent Context (compact): ${fileInfo.path}`);
  console.log(`  Language: ${fileInfo.language}`);
  if (fileInfo.role) console.log(`  Role: ${fileInfo.role}`);
  if (options.focus.length > 0) console.log(`  Focus: ${options.focus.join(", ")}`);
  console.log(
    `  Tokens: ${ctx.usedTokens} / ${options.tokenBudget}${ctx.truncated ? " (truncated)" : ""}`,
  );
  if (fileInfo.parserMode) console.log(`  Parser mode: ${fileInfo.parserMode}`);
  if (fileInfo.parseWarnings && fileInfo.parseWarnings.length > 0) {
    console.log(`  Parse warnings (${fileInfo.parseWarnings.length}):`);
    fileInfo.parseWarnings.slice(0, 3).forEach((w) => console.log(`    - ${w}`));
  }
  if (fileInfo.parseErrorMessages && fileInfo.parseErrorMessages.length > 0) {
    console.log(`  Parse errors (${fileInfo.parseErrorMessages.length}):`);
    fileInfo.parseErrorMessages.slice(0, 3).forEach((e) => console.log(`    - ${e}`));
  }

  const more = (n: number): string => (n > 0 ? `, ${n} more not shown` : "");

  console.log(`\n  Symbols (${fileInfo.symbols.length}${more(fileInfo.symbolsTruncated)}):`);
  for (const s of fileInfo.symbols) {
    console.log(`    ${s.type} ${s.name} @ ${s.line}${s.parent ? ` (in ${s.parent})` : ""}`);
  }

  if (ctx.directImports.length > 0) {
    console.log(
      `\n  Direct imports (${ctx.directImports.length}${more(ctx.directImportsTruncated)}):`,
    );
    for (const p of ctx.directImports) console.log(`    - ${p}`);
  }

  if (ctx.directDependents.length > 0) {
    console.log(
      `\n  Direct dependents (${ctx.directDependents.length}${more(ctx.directDependentsTruncated)}):`,
    );
    for (const p of ctx.directDependents) console.log(`    - ${p}`);
  }

  if (ctx.hubFiles.length > 0) {
    console.log(`\n  Hub files (${ctx.hubFiles.length}${more(ctx.hubFilesTruncated)}):`);
    for (const h of ctx.hubFiles) {
      console.log(`    - ${h.path} (imported by ${h.importedByCount} files)`);
    }
  }

  if (fileInfo.calls && fileInfo.calls.length > 0) {
    console.log(
      `\n  Outbound calls (${fileInfo.calls.length}${more(fileInfo.callsTruncated ?? 0)}):`,
    );
    for (const c of fileInfo.calls) {
      console.log(`    ${c.callee} @ ${c.line}${c.inSymbol ? ` (in ${c.inSymbol})` : ""}`);
    }
  }

  if (ctx.incomingCalls.length > 0) {
    console.log(
      `\n  Incoming call candidates (${ctx.incomingCalls.length}${more(ctx.incomingCallsTruncated)}):`,
    );
    for (const c of ctx.incomingCalls) {
      console.log(
        `    ${c.callee} @ ${c.fromFile}:${c.line}${c.inSymbol ? ` (in ${c.inSymbol})` : ""}`,
      );
    }
  }

  console.log();
  return 0;
}
