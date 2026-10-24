/**
 * Shared emission policy for token-budgeted capsules.
 *
 * `usedTokens` is a hard cap on the JSON that actually reaches the consumer,
 * so a packer must measure the exact bytes it will emit:
 * - MCP is always compact and carries a `{ status: "ok" }` envelope.
 * - The CLI measures pretty-printed JSON whenever `--pretty` (or a TTY) is on,
 *   because the whitespace ships to the agent too.
 */

import { estimateTokens } from "../../utils/tokens.js";

export interface EmitPolicy {
  /** Measure and emit pretty-printed JSON (2-space indent). MCP never sets this. */
  pretty?: boolean;
  /** Envelope keys merged ahead of the capsule (MCP `{ status: "ok" }`). */
  envelope?: Record<string, unknown>;
}

/** Render a capsule exactly as it will be emitted under `policy`. */
export function emitPolicyJson(value: unknown, policy: EmitPolicy = {}): string {
  const payload = policy.envelope
    ? { ...policy.envelope, ...(value as Record<string, unknown>) }
    : value;
  return policy.pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);
}

/**
 * Resolve `usedTokens` to a fixed point: writing the count into the capsule
 * changes the capsule's own size, so re-measure until stable (bounded).
 */
export async function resolveUsedTokens<T extends { usedTokens: number }>(
  capsule: T,
  policy: EmitPolicy = {},
): Promise<T> {
  let current: T = { ...capsule, usedTokens: 0 };
  for (let i = 0; i < 6; i++) {
    const tokens = await estimateTokens(emitPolicyJson(current, policy));
    if (tokens === current.usedTokens) return current;
    current = { ...current, usedTokens: tokens };
  }
  return current;
}
