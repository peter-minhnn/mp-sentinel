/**
 * High-level facade the editor adapter talks to. Ties together env injection,
 * argument building, process execution, and JSON parsing so UI code stays thin
 * and free of CLI details.
 *
 * Exit-code policy: review operations treat exit 1 as "findings exist" (a parsed
 * report is still returned); exit 2 is a runtime error and rejects. Pure query
 * operations (indexing health, explain-context) parse on exit 0/1 and reject on
 * exit 2.
 */

import {
  buildCreateSkillsArgs,
  buildExplainContextArgs,
  buildIndexingArgs,
  buildReviewArgs,
  type CreateSkillsOptions,
  type IndexingOperation,
  type ReviewOptions,
} from "./command-builder.js";
import { buildEnv, type AiSelection } from "./env.js";
import { CliExecError, CliRuntimeError } from "./errors.js";
import {
  CliJsonParseError,
  parseCreateSkillsCheck,
  parseExplainContext,
  parseIndexHealth,
  parseReviewReport,
} from "./parse.js";
import { CliRunner, type CliRunnerConfig, type CliRunResult } from "./runner.js";
import { redactSecrets, type SecretBundle } from "./secrets.js";
import type {
  CreateSkillsCheckOutput,
  ExplainContextOutput,
  IndexHealthOutput,
  ReviewReport,
} from "./types.js";

export interface ServiceContext {
  /** Project/workspace root the CLI runs in. */
  cwd: string;
  /** Non-secret AI selection from settings. */
  ai?: AiSelection;
  /** Secret credentials from the host secret store. */
  secrets?: SecretBundle;
  /** Extra non-secret MCP env vars. */
  mcpEnv?: Record<string, string>;
  /** Cancellation signal. */
  signal?: AbortSignal;
  /** Per-run timeout override. */
  timeoutMs?: number;
}

export class MpSentinelService {
  private readonly runner: CliRunner;

  constructor(runnerConfig: CliRunnerConfig) {
    this.runner = new CliRunner(runnerConfig);
  }

  private async exec(args: readonly string[], ctx: ServiceContext): Promise<CliRunResult> {
    const env = buildEnv({
      baseEnv: process.env,
      ...(ctx.ai !== undefined ? { ai: ctx.ai } : {}),
      ...(ctx.secrets !== undefined ? { secrets: ctx.secrets } : {}),
      ...(ctx.mcpEnv !== undefined ? { mcpEnv: ctx.mcpEnv } : {}),
    });

    return this.runner.run({
      args,
      cwd: ctx.cwd,
      env,
      ...(ctx.secrets !== undefined ? { secrets: ctx.secrets } : {}),
      ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
      ...(ctx.timeoutMs !== undefined ? { timeoutMs: ctx.timeoutMs } : {}),
    });
  }

  private failOnRuntimeError(result: CliRunResult, ctx: ServiceContext): void {
    if (result.exitCode === 2) {
      const stderr = redactSecrets(result.stderr, ctx.secrets);
      throw new CliRuntimeError(
        `mp-sentinel exited with a runtime error (code 2).`,
        result.exitCode,
        stderr,
      );
    }
  }

  /**
   * Parses CLI stdout, converting a {@link CliJsonParseError} into a typed
   * {@link CliExecError} of kind `parse` so the adapter can present a uniform,
   * secret-free message. The raw (redacted) stderr is attached for the output
   * channel.
   */
  private parse<T>(
    parser: (stdout: string) => T,
    result: CliRunResult,
    ctx: ServiceContext,
  ): T {
    try {
      return parser(result.stdout);
    } catch (error) {
      if (error instanceof CliJsonParseError) {
        throw new CliExecError("parse", error.message, {
          stderr: redactSecrets(result.stderr, ctx.secrets),
          cause: error,
        });
      }
      throw error;
    }
  }

  /** Runs a review. Returns the parsed report for exit 0 (PASS) and 1 (findings). */
  async review(options: ReviewOptions, ctx: ServiceContext): Promise<ReviewReport> {
    const args = buildReviewArgs({ ...options, format: options.format ?? "json" });
    const result = await this.exec(args, ctx);
    this.failOnRuntimeError(result, ctx);
    return this.parse(parseReviewReport, result, ctx);
  }

  /** Context/token preview with no AI call. */
  async explainContext(files: readonly string[], ctx: ServiceContext): Promise<ExplainContextOutput> {
    const result = await this.exec(buildExplainContextArgs(files), ctx);
    this.failOnRuntimeError(result, ctx);
    return this.parse(parseExplainContext, result, ctx);
  }

  /** Read-only source index health. */
  async indexHealth(ctx: ServiceContext): Promise<IndexHealthOutput> {
    const result = await this.exec(buildIndexingArgs({ kind: "health" }), ctx);
    this.failOnRuntimeError(result, ctx);
    return this.parse(parseIndexHealth, result, ctx);
  }

  /** Rebuilds the source index cache. Returns the raw run result. */
  async rebuildIndex(ctx: ServiceContext, force = false): Promise<CliRunResult> {
    const result = await this.exec(buildIndexingArgs({ kind: "rebuild", force }), ctx);
    this.failOnRuntimeError(result, ctx);
    return result;
  }

  /** Generic indexing query (recovered, parse-errors, stats, explain-index, agent-context). */
  async indexing(operation: IndexingOperation, ctx: ServiceContext): Promise<CliRunResult> {
    const result = await this.exec(buildIndexingArgs(operation), ctx);
    this.failOnRuntimeError(result, ctx);
    return result;
  }

  /** create-skills staleness gate. Exit 0 = ok, 1 = stale; both parse. */
  async createSkillsCheck(
    agents: CreateSkillsOptions["agents"],
    ctx: ServiceContext,
  ): Promise<CreateSkillsCheckOutput> {
    const args = buildCreateSkillsArgs({
      operation: { kind: "check" },
      ...(agents !== undefined ? { agents } : {}),
      json: true,
    });
    const result = await this.exec(args, ctx);
    this.failOnRuntimeError(result, ctx);
    return this.parse(parseCreateSkillsCheck, result, ctx);
  }

  /** create-skills generate/update. Returns the raw run result. */
  async createSkills(options: CreateSkillsOptions, ctx: ServiceContext): Promise<CliRunResult> {
    const result = await this.exec(buildCreateSkillsArgs(options), ctx);
    this.failOnRuntimeError(result, ctx);
    return result;
  }
}
