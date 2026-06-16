/**
 * Typed CLI execution failures for editor-extension UX.
 *
 * The runner/service distinguish *why* a CLI invocation failed so the adapter
 * can react appropriately (silent on user cancellation, a "couldn't launch"
 * hint on spawn errors, the output channel on a runtime error, etc.) instead of
 * surfacing one opaque message for every failure.
 *
 * Every message carried here is user-safe: `stderr` is redacted by the service
 * before it is attached, and the kind→message map never echoes CLI output.
 */

export type CliFailureKind =
  /** The CLI binary could not be launched (e.g. ENOENT, bad `cli.command`). */
  | "spawn"
  /** The run exceeded the configured timeout and was killed. */
  | "timeout"
  /** The run was cancelled (user dismissed progress, or a newer run superseded it). */
  | "aborted"
  /** The CLI ran but exited with a runtime/system error (exit code 2). */
  | "runtime"
  /** The CLI ran but its stdout could not be parsed as the expected JSON. */
  | "parse";

export interface CliExecErrorOptions {
  /** Redacted, secret-free stderr to surface in the output channel. */
  stderr?: string;
  /** CLI exit code, when the process actually exited. */
  exitCode?: number;
  /** Underlying cause, preserved for logging. */
  cause?: unknown;
}

/**
 * A CLI invocation failure tagged with a {@link CliFailureKind}. Extends `Error`
 * so existing `instanceof Error` handling keeps working.
 */
export class CliExecError extends Error {
  readonly kind: CliFailureKind;
  /** Redacted stderr (empty string when there is none). */
  readonly stderr: string;
  readonly exitCode?: number;

  constructor(kind: CliFailureKind, message: string, options: CliExecErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "CliExecError";
    this.kind = kind;
    this.stderr = options.stderr ?? "";
    if (options.exitCode !== undefined) this.exitCode = options.exitCode;
  }
}

/**
 * Backwards-compatible alias for an exit-code-2 runtime error. Retained so
 * callers that check `instanceof CliRuntimeError` continue to work; new code
 * can branch on {@link CliExecError.kind} instead.
 */
export class CliRuntimeError extends CliExecError {
  constructor(message: string, exitCode: number, stderr: string) {
    super("runtime", message, { stderr, exitCode });
    this.name = "CliRuntimeError";
  }
}

/** True for a cancellation — the adapter should stay silent rather than alarm. */
export function isAborted(error: unknown): boolean {
  return error instanceof CliExecError && error.kind === "aborted";
}

/**
 * A short, user-safe sentence for a failure kind. Never includes CLI output or
 * secrets — callers pair this with the (redacted) output channel for detail.
 */
export function userMessageForFailure(kind: CliFailureKind): string {
  switch (kind) {
    case "spawn":
      return "Couldn't launch the mp-sentinel CLI. Check the mpSentinel.cli.command setting and that the CLI is installed.";
    case "timeout":
      return "The mp-sentinel CLI timed out. Increase mpSentinel.cli.timeoutMs or narrow the review scope.";
    case "aborted":
      return "MP Sentinel run cancelled.";
    case "runtime":
      return "The mp-sentinel CLI reported a runtime error. See the MP Sentinel output for details.";
    case "parse":
      return "Couldn't parse the mp-sentinel CLI output. See the MP Sentinel output for details.";
  }
}
