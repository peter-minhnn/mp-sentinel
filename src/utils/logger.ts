/**
 * Console output utilities with colors.
 *
 * Styling goes through the shared terminal UI theme (`paint`), which
 * honors the NO_COLOR convention — no ANSI escapes are emitted when
 * NO_COLOR is set to a non-empty value.
 */

import { paint, type AnsiStyle } from "./terminal-ui.js";

let quietMode = false;

export const setLogQuietMode = (value: boolean): void => {
  quietMode = value;
};

const write = (fn: (...args: Array<string>) => void, value: string): void => {
  if (quietMode) return;
  fn(value);
};

export const log = {
  info: (msg: string) => write(console.log, `${paint("ℹ", "blue")} ${msg}`),
  success: (msg: string) => write(console.log, `${paint("✅", "green")} ${msg}`),
  // stderr-routed info/success/warning/error — used when stdout is reserved
  // for machine output (e.g. `--format json|sarif`). Intentionally BYPASS
  // quiet mode: those formats enable quiet to clean stdout, but diagnostics
  // posted to stderr must stay visible to CI operators (a silenced GitLab
  // API error would hide real failures). Never writes to stdout.
  infoStderr: (msg: string) => console.error(`${paint("ℹ", "blue")} ${msg}`),
  successStderr: (msg: string) => console.error(`${paint("✅", "green")} ${msg}`),
  warningStderr: (msg: string) => console.error(`${paint("⚠️", "yellow")}  ${msg}`),
  errorStderr: (msg: string) => console.error(`${paint("❌", "red")} ${msg}`),
  warning: (msg: string) => write(console.warn, `${paint("⚠️", "yellow")}  ${msg}`),
  error: (msg: string) => write(console.error, `${paint("❌", "red")} ${msg}`),
  critical: (msg: string) => write(console.error, `${paint("🚨", "red", "bold")} ${msg}`),
  audit: (msg: string) => write(console.log, `${paint("🔍", "cyan")} ${msg}`),
  skip: (msg: string) => write(console.log, `${paint("⏩", "magenta")} ${msg}`),
  file: (msg: string) => write(console.log, paint(`   ${msg}`, "dim")),
  // Pre-styled line (caller owns indentation/colors) — still honors quiet mode
  plain: (msg: string) => write(console.log, msg),
  debug: (msg: string) => write(console.log, paint(`🐛 ${msg}`, "dim")),

  // Issue formatting
  issue: (severity: string, line: number, message: string) => {
    if (quietMode) return;
    const style: AnsiStyle =
      severity === "CRITICAL" ? "red" : severity === "WARNING" ? "yellow" : "blue";
    console.log(`   ${paint(`[${severity}] Line ${line}: ${message}`, style)}`);
  },

  // Progress bar — adapts to terminal width to avoid overflow on narrow terminals
  progress: (current: number, total: number, label: string) => {
    if (quietMode) return;
    const percent = Math.round((current / total) * 100);
    const cols = process.stdout.columns ?? 80;
    const barLength = Math.max(10, Math.min(40, cols - label.length - 20));
    const filled = Math.round((current / total) * barLength);
    const bar = "█".repeat(filled) + "░".repeat(barLength - filled);
    process.stdout.write(`\r${paint(bar, "cyan")} ${percent}% | ${label}`);
  },

  progressEnd: () => {
    if (quietMode) return;
    console.log(); // New line after progress
  },

  // Divider
  divider: () => {
    if (quietMode) return;
    console.log(paint("─".repeat(50), "dim"));
  },

  // Header
  header: (title: string) => {
    if (quietMode) return;
    console.log();
    console.log(paint(`🏗️  ${title}`, "cyan", "bold"));
    console.log(paint("─".repeat(50), "dim"));
  },
};

/**
 * Format duration for display
 */
export const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
};
