/**
 * Console output utilities with colors
 */

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
} as const;

export const log = {
  info: (msg: string) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  success: (msg: string) => console.log(`${colors.green}✅${colors.reset} ${msg}`),
  warning: (msg: string) => console.warn(`${colors.yellow}⚠️${colors.reset}  ${msg}`),
  error: (msg: string) => console.error(`${colors.red}❌${colors.reset} ${msg}`),
  critical: (msg: string) => console.error(`${colors.red}${colors.bold}🚨${colors.reset} ${msg}`),
  audit: (msg: string) => console.log(`${colors.cyan}🔍${colors.reset} ${msg}`),
  skip: (msg: string) => console.log(`${colors.magenta}⏩${colors.reset} ${msg}`),
  file: (msg: string) => console.log(`${colors.dim}   ${msg}${colors.reset}`),
  
  // Issue formatting
  issue: (severity: string, line: number, message: string) => {
    const color = severity === 'CRITICAL' ? colors.red : 
                  severity === 'WARNING' ? colors.yellow : 
                  colors.blue;
    console.log(`   ${color}[${severity}] Line ${line}: ${message}${colors.reset}`);
  },
  
  // Progress bar
  progress: (current: number, total: number, label: string) => {
    const percent = Math.round((current / total) * 100);
    const barLength = 20;
    const filled = Math.round((current / total) * barLength);
    const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);
    process.stdout.write(`\r${colors.cyan}${bar}${colors.reset} ${percent}% | ${label}`);
  },
  
  progressEnd: () => {
    console.log(); // New line after progress
  },

  // Divider
  divider: () => console.log(`${colors.dim}${'─'.repeat(50)}${colors.reset}`),
  
  // Header
  header: (title: string) => {
    console.log();
    console.log(`${colors.bold}${colors.cyan}🏗️  ${title}${colors.reset}`);
    console.log(`${colors.dim}${'─'.repeat(50)}${colors.reset}`);
  },
};

/**
 * Format duration for display
 */
export const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
};
