/**
 * JSON emission for indexing CLI/MCP output.
 *
 * Agents capture stdout, so compact JSON is the default off-TTY.
 * Humans on a TTY get pretty-printed JSON unless --compact is set.
 */

let prettyJson = false;

export function setIndexJsonPretty(pretty: boolean): void {
  prettyJson = pretty;
}

export function isIndexJsonPretty(): boolean {
  return prettyJson;
}

/**
 * Resolve pretty vs compact JSON.
 * `--compact` wins over `--pretty`. When neither is set, pretty-print only on a TTY.
 */
export function resolvePrettyJson(opts: { pretty?: boolean; compact?: boolean }): boolean {
  if (opts.compact) return false;
  if (opts.pretty) return true;
  return Boolean(process.stdout.isTTY);
}

export function stringifyIndexJson(value: unknown, pretty: boolean = prettyJson): string {
  return pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
}

/** Always compact. MCP must not inherit CLI `--pretty` global state. */
export function stringifyCompactJson(value: unknown): string {
  return JSON.stringify(value);
}

export function emitIndexJson(value: unknown): void {
  console.log(stringifyIndexJson(value));
}
