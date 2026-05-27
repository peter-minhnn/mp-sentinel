/**
 * Shared type re-export for per-language risk pattern packs (Phase 2.3).
 *
 * Language-specific pattern files import `RiskPattern` from here so they
 * can be added to the analyzer's loop without an unsafe cast.
 */

export type { RiskPattern as LanguageRiskPattern } from "../index.js";
