/**
 * Internal terminal UI theme — ANSI styling helpers for human-readable
 * console output (review reports and summaries).
 *
 * Honors the NO_COLOR convention (https://no-color.org): when the NO_COLOR
 * environment variable is set to a non-empty value, every helper returns
 * unstyled text. Machine-readable formats (json/markdown/sarif) never go
 * through this module, so their output stays free of ANSI escapes.
 */

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
} as const;

export type AnsiStyle = keyof typeof ANSI;

/** Colors are enabled unless NO_COLOR is set to a non-empty value. */
export const colorEnabled = (): boolean => {
  const noColor = process.env["NO_COLOR"];
  return noColor === undefined || noColor === "";
};

/** Wrap text in ANSI styles when color is enabled; otherwise return as-is. */
export const paint = (text: string, ...styles: AnsiStyle[]): string => {
  if (styles.length === 0 || !colorEnabled()) return text;
  const prefix = styles.map((style) => ANSI[style]).join("");
  return `${prefix}${text}${ANSI.reset}`;
};

/** Bold text. */
export const bold = (text: string): string => paint(text, "bold");

/** Dim (muted) text. */
export const dim = (text: string): string => paint(text, "dim");

// ── Badges ──────────────────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<string, AnsiStyle[]> = {
  CRITICAL: ["red", "bold"],
  WARNING: ["yellow"],
  INFO: ["blue"],
};

/** Fixed-width colored severity label (CRITICAL / WARNING / INFO). */
export const severityBadge = (severity: string): string => {
  const label = severity.padEnd(8);
  return paint(label, ...(SEVERITY_STYLES[severity] ?? ["dim"]));
};

const STATUS_STYLES: Record<string, AnsiStyle[]> = {
  PASS: ["green", "bold"],
  FAIL: ["red", "bold"],
  ERROR: ["magenta", "bold"],
};

/** Colored status label for PASS / FAIL / ERROR. */
export const statusBadge = (status: string): string =>
  paint(status, ...(STATUS_STYLES[status] ?? ["bold"]));

/**
 * Severity/metric count token: colored when the count is non-zero,
 * dimmed when zero (e.g. "2 critical" red vs "0 critical" dim).
 */
export const countToken = (count: number, label: string, style: AnsiStyle): string => {
  const text = `${count} ${label}`;
  return count > 0 ? paint(text, style) : dim(text);
};

// ── Layout ──────────────────────────────────────────────────────────────────

const DIVIDER_WIDTH = 50;
const KEY_WIDTH = 14;

/** Dim horizontal divider line. */
export const divider = (width: number = DIVIDER_WIDTH): string => dim("─".repeat(width));

/** Dim mid-dot separator for inline value lists. */
export const dot = (): string => dim(" · ");

/** Section header lines: blank line, bold title, dim divider. */
export const sectionHeader = (title: string): string[] => [
  "",
  `  ${bold(title)}`,
  `  ${divider()}`,
];

/** Two-column key/value row with a dim, padded label. */
export const keyValueRow = (label: string, value: string): string =>
  `  ${dim(label.padEnd(KEY_WIDTH))}${value}`;

/**
 * Compact application header: product name, version, and a subtitle line
 * (status/target/duration), followed by a divider.
 */
export const appHeader = (version: string, subtitle: string): string[] => [
  "",
  `  ${paint("MP Sentinel", "cyan", "bold")} ${dim(`v${version}`)}${dot()}Code Review`,
  `  ${subtitle}`,
  `  ${divider()}`,
];
