/**
 * Spawns the `mp-sentinel` CLI and captures its result.
 *
 * Design notes:
 * - Secrets travel via the child environment only. {@link assertNoSecretsInArgs}
 *   guards against an accidental leak onto the command line before spawning.
 * - Exit codes carry meaning: 0 = PASS, 1 = actionable findings, 2 = runtime
 *   error. The runner returns the code verbatim; callers decide what it means
 *   for their operation (a review exiting 1 is a normal "findings exist", not a
 *   failure to run).
 * - The spawn function is injectable so the builder/runner can be unit-tested
 *   without a real child process.
 */

import { spawn as nodeSpawn } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";

import { CliExecError } from "./errors.js";
import { assertNoSecretsInArgs, redactSecrets, type SecretBundle } from "./secrets.js";

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export interface CliRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  signal: NodeJS.Signals | null;
  /** The argv passed to the CLI (secret-free, safe to log). */
  args: readonly string[];
}

/** A live chunk of CLI output, already redacted and safe to display. */
export interface CliOutputEvent {
  stream: "stdout" | "stderr";
  /** Redacted chunk text (secrets masked via {@link redactSecrets}). */
  chunk: string;
}

export interface RunOptions {
  args: readonly string[];
  /** Working directory — the workspace/project root. */
  cwd: string;
  /** Fully-built environment (see env.ts). */
  env: Record<string, string>;
  /** Secret bundle, used only for the no-leak assertion (never logged). */
  secrets?: SecretBundle;
  /** Abort the run early (e.g. user cancelled, or a newer run superseded it). */
  signal?: AbortSignal;
  /** Kill the process after this many ms. Default 120000. */
  timeoutMs?: number;
  /**
   * Live output callback, invoked per chunk with already-redacted text. stdout
   * is still buffered for parsing; this is for surfacing progress (typically
   * stderr) to a UI. Never receives raw secrets.
   */
  onOutput?: (event: CliOutputEvent) => void;
}

export interface CliRunnerConfig {
  /**
   * Executable to invoke. Examples: an absolute path to the CLI, "mp-sentinel"
   * on PATH, or "npx" with `baseArgs: ["mp-sentinel"]`.
   */
  command: string;
  /** Args prepended to every invocation (e.g. ["mp-sentinel"] when command is "npx"). */
  baseArgs?: readonly string[];
  /** Injected for testing. Defaults to node:child_process spawn. */
  spawnFn?: SpawnFn;
}

const DEFAULT_TIMEOUT_MS = 120_000;

export class CliRunner {
  private readonly command: string;
  private readonly baseArgs: readonly string[];
  private readonly spawnFn: SpawnFn;

  constructor(config: CliRunnerConfig) {
    this.command = config.command;
    this.baseArgs = config.baseArgs ?? [];
    this.spawnFn = config.spawnFn ?? (nodeSpawn as SpawnFn);
  }

  run(options: RunOptions): Promise<CliRunResult> {
    const fullArgs = [...this.baseArgs, ...options.args];
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return new Promise<CliRunResult>((resolve, reject) => {
      // Throwing inside the executor rejects the promise — keeps a uniform async
      // contract so a leak guard failure surfaces as a rejection, not a sync throw.
      assertNoSecretsInArgs(fullArgs, options.secrets);

      const child = this.spawnFn(this.command, fullArgs, {
        cwd: options.cwd,
        env: options.env,
        // Windows-friendly: allow PATHEXT resolution for `mp-sentinel.cmd` etc.
        shell: false,
      });

      let stdout = "";
      let stderr = "";
      let settled = false;

      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (options.signal) options.signal.removeEventListener("abort", onAbort);
        fn();
      };

      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        finish(() =>
          reject(new CliExecError("timeout", `mp-sentinel timed out after ${timeoutMs}ms`)),
        );
      }, timeoutMs);

      const onAbort = (): void => {
        child.kill("SIGTERM");
        finish(() => reject(new CliExecError("aborted", "mp-sentinel run aborted")));
      };
      if (options.signal) {
        if (options.signal.aborted) {
          child.kill("SIGTERM");
          return finish(() => reject(new CliExecError("aborted", "mp-sentinel run aborted")));
        }
        options.signal.addEventListener("abort", onAbort, { once: true });
      }

      const emit = (stream: "stdout" | "stderr", text: string): void => {
        if (!options.onOutput) return;
        options.onOutput({ stream, chunk: redactSecrets(text, options.secrets) });
      };

      child.stdout?.on("data", (chunk: Buffer | string) => {
        const text = chunk.toString();
        stdout += text;
        emit("stdout", text);
      });
      child.stderr?.on("data", (chunk: Buffer | string) => {
        const text = chunk.toString();
        stderr += text;
        emit("stderr", text);
      });

      child.on("error", (error: Error) => {
        // A spawn failure (e.g. ENOENT for a missing binary). Redact defensively
        // even though such messages don't normally carry secrets.
        const message = redactSecrets(error.message, options.secrets);
        finish(() => reject(new CliExecError("spawn", message, { cause: error })));
      });

      child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
        finish(() =>
          resolve({
            exitCode: code ?? (signal ? 143 : 1),
            stdout,
            stderr,
            signal,
            args: fullArgs,
          }),
        );
      });

      return undefined;
    });
  }
}
