/**
 * `check-ai` — fast AI connectivity check.
 *
 * Resolves the provider from the ambient environment (the same AI_PROVIDER /
 * AI_MODEL / ANTHROPIC_BASE_URL / credential variables a review uses), makes one
 * tiny request, and reports the outcome as JSON on stdout. This surfaces a 403,
 * an invalid base URL, or an unknown model *before* a large review runs.
 *
 * Exit codes: 0 = reachable, 2 = misconfigured/unreachable. Output is JSON-only.
 * `provider` / `model` are reported whenever the environment names them — even
 * when the credential is missing — so the caller can show what was attempted.
 */

import { AIConfig, AIProviderFactory } from "../services/ai/index.js";
import { setLogQuietMode } from "../utils/logger.js";

export interface CheckAiResult {
  status: "ok" | "error";
  provider?: string;
  model?: string;
  error?: string;
}

const emit = (result: CheckAiResult, code: number): number => {
  console.log(JSON.stringify(result, null, 2));
  return code;
};

export async function runCheckAiCommand(): Promise<number> {
  // stdout is reserved for the JSON result; keep all logs quiet.
  setLogQuietMode(true);

  // Probe (never throws) so provider/model survive a missing key or bad config.
  const probe = AIConfig.probeEnvironment();
  if (probe.status !== "ready") {
    return emit(
      {
        status: "error",
        ...(probe.provider !== undefined ? { provider: probe.provider } : {}),
        ...(probe.model !== undefined ? { model: probe.model } : {}),
        error: probe.reason,
      },
      2,
    );
  }

  const { provider, model } = probe.config;
  try {
    const ai = AIProviderFactory.createProvider(probe.config);
    // Minimal request — enough to exercise auth, base URL, and model id.
    await ai.generateContent("Connectivity check. Reply with: ok", "ok");
    return emit({ status: "ok", provider, model }, 0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emit({ status: "error", provider, model, error: message }, 2);
  }
}
