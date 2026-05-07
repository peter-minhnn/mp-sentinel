/**
 * Safe environment variable forwarding for MCP child processes.
 * Only copies explicitly named variables from process.env.
 * Never passes the full process.env to child processes.
 *
 * Input format: { "CHILD_ENV_NAME": "PARENT_ENV_NAME" }
 * Output format: { "CHILD_ENV_NAME": "value_from_process.env[PARENT_ENV_NAME]" }
 */
export const sanitizeEnv = (envMap: Record<string, string>): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const [childKey, processKey] of Object.entries(envMap)) {
    const value = process.env[processKey];
    if (value !== undefined) {
      result[childKey] = value;
    }
  }
  return result;
};
