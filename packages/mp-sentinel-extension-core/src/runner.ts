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
import { existsSync } from "node:fs";
import path from "node:path";

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

interface SpawnPlan {
  command: string;
  args: readonly string[];
}

function isNpxCommand(command: string): boolean {
  const base = path.basename(command).toLowerCase();
  return base === "npx" || base === "npx.cmd" || base === "npx.ps1";
}

function windowsPathEntries(): string[] {
  return (process.env["PATH"] ?? process.env["Path"] ?? "")
    .split(path.delimiter)
    .filter((entry) => entry.length > 0);
}

function windowsExecutableCandidates(command: string): string[] {
  const hasPath = command.includes("/") || command.includes("\\") || path.isAbsolute(command);
  const hasExt = path.extname(command).length > 0;
  const extensions = hasExt
    ? [""]
    : (process.env["PATHEXT"] ?? ".COM;.EXE;.BAT;.CMD;.PS1")
        .split(";")
        .filter((ext) => ext.length > 0);
  const names = extensions.map((ext) => `${command}${ext.toLowerCase()}`);

  if (hasPath) return names;
  return windowsPathEntries().flatMap((entry) => names.map((name) => path.join(entry, name)));
}

function findWindowsExecutable(command: string): string | undefined {
  return windowsExecutableCandidates(command).find((candidate) => existsSync(candidate));
}

function npxCliPath(npxExecutable: string): string | undefined {
  const candidate = path.join(
    path.dirname(npxExecutable),
    "node_modules",
    "npm",
    "bin",
    "npx-cli.js",
  );
  return existsSync(candidate) ? candidate : undefined;
}

function nodeBesideNpx(npxExecutable: string): string {
  const candidate = path.join(path.dirname(npxExecutable), "node.exe");
  return existsSync(candidate) ? candidate : "node.exe";
}

/**
 * Terminate a child and everything it spawned.
 *
 * `child.kill("SIGTERM")` only signals the direct child. When the CLI is
 * launched via `npx` (which spawns a `node` grandchild that does the real
 * work) or otherwise spawns sub-processes, a plain SIGTERM leaves the
 * grandchild running — the review keeps going after the user cancels. On
 * Windows there are no real signals at all, so we use `taskkill /T /F` to
 * tear down the whole tree by PID. On POSIX, SIGTERM to the child is enough
 * for our single-process CLI, with SIGKILL as a fallback.
 */
function killProcessTree(child: ChildProcess): void {
  if (child.pid === undefined) {
    child.kill("SIGKILL");
    return;
  }
  if (process.platform === "win32") {
    try {
      nodeSpawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      child.kill();
    }
    return;
  }
  child.kill("SIGTERM");
}

function buildSpawnPlan(command: string, args: readonly string[]): SpawnPlan {
  if (process.platform === "win32" && isNpxCommand(command)) {
    const npxExecutable = findWindowsExecutable(command);
    const cliPath = npxExecutable ? npxCliPath(npxExecutable) : undefined;
    if (npxExecutable && cliPath) {
      return { command: nodeBesideNpx(npxExecutable), args: [cliPath, ...args] };
    }
  }

  return { command, args };
}

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
      const spawnPlan = buildSpawnPlan(this.command, fullArgs);

      const child = this.spawnFn(spawnPlan.command, spawnPlan.args, {
        cwd: options.cwd,
        env: options.env,
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
        killProcessTree(child);
        finish(() =>
          reject(new CliExecError("timeout", `mp-sentinel timed out after ${timeoutMs}ms`)),
        );
      }, timeoutMs);

      const onAbort = (): void => {
        killProcessTree(child);
        finish(() => reject(new CliExecError("aborted", "mp-sentinel run aborted")));
      };
      if (options.signal) {
        if (options.signal.aborted) {
          killProcessTree(child);
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
