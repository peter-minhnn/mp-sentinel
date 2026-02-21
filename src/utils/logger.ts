/**
 * Console output utilities with colors
 */

// ANSI color codes
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
} as const;

let quietMode = false;

export const setLogQuietMode = (value: boolean): void => {
  quietMode = value;
};

const write = (fn: (...args: Array<string>) => void, value: string): void => {
  if (quietMode) return;
  fn(value);
};

export const log = {
  info: (msg: string) => write(console.log, `${colors.blue}ℹ${colors.reset} ${msg}`),
  success: (msg: string) => write(console.log, `${colors.green}✅${colors.reset} ${msg}`),
  warning: (msg: string) => write(console.warn, `${colors.yellow}⚠️${colors.reset}  ${msg}`),
  error: (msg: string) => write(console.error, `${colors.red}❌${colors.reset} ${msg}`),
  critical: (msg: string) =>
    write(console.error, `${colors.red}${colors.bold}🚨${colors.reset} ${msg}`),
  audit: (msg: string) => write(console.log, `${colors.cyan}🔍${colors.reset} ${msg}`),
  skip: (msg: string) => write(console.log, `${colors.magenta}⏩${colors.reset} ${msg}`),
  file: (msg: string) => write(console.log, `${colors.dim}   ${msg}${colors.reset}`),

  // Issue formatting
  issue: (severity: string, line: number, message: string) => {
    if (quietMode) return;
    const color =
      severity === "CRITICAL" ? colors.red : severity === "WARNING" ? colors.yellow : colors.blue;
    console.log(`   ${color}[${severity}] Line ${line}: ${message}${colors.reset}`);
  },

  // Progress bar — adapts to terminal width to avoid overflow on narrow terminals
  progress: (current: number, total: number, label: string) => {
    if (quietMode) return;
    const percent = Math.round((current / total) * 100);
    const cols = process.stdout.columns ?? 80;
    const barLength = Math.max(10, Math.min(40, cols - label.length - 20));
    const filled = Math.round((current / total) * barLength);
    const bar = "█".repeat(filled) + "░".repeat(barLength - filled);
    process.stdout.write(`\r${colors.cyan}${bar}${colors.reset} ${percent}% | ${label}`);
  },

  progressEnd: () => {
    if (quietMode) return;
    console.log(); // New line after progress
  },

  // Divider
  divider: () => {
    if (quietMode) return;
    console.log(`${colors.dim}${"─".repeat(50)}${colors.reset}`);
  },

  // Header
  header: (title: string) => {
    if (quietMode) return;
    console.log();
    console.log(`${colors.bold}${colors.cyan}🏗️  ${title}${colors.reset}`);
    console.log(`${colors.dim}${"─".repeat(50)}${colors.reset}`);
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
