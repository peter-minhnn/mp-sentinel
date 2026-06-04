export { generateContent } from "./content.js";
export type { GeneratedContent, SkillSections } from "./content.js";
export { buildSkillKnowledgeBase } from "./knowledge-base.js";
export type {
  SkillKnowledgeBase,
  ModuleInfo,
  EntrypointInfo,
  TestingMap,
  TestGapEntry,
  DepMapEntry,
  RiskEntry,
} from "../../types/index.js";
export {
  ADAPTER_REGISTRY,
  getAdapter,
  parseAgentFlag,
  detectAdapters,
  explainAgentDetection,
} from "./registry.js";
export {
  computeIndexHash,
  computeGenerationConfigHash,
  EMPTY_GENERATION_CONFIG_HASH,
  renderMetadataHeader,
  parseMetadataFromContent,
  applyMetadataHeader,
} from "./metadata.js";
export type { SkillsMetadata } from "./metadata.js";
export { detectLanguageProfile } from "./language-profile.js";
export type { LanguageProfile } from "./language-profile.js";
export { detectCodeStyleProfile } from "./code-style-profile.js";
export type { CodeStyleProfile } from "./code-style-profile.js";
export { detectProfile } from "./profile.js";
export type { SkillProfile } from "./profile.js";
export { buildIndexInsights } from "./insights.js";
export {
  validateAIEnrichmentOutput,
  buildEnrichmentInput,
  computeEnrichmentInputHash,
  computeEnrichmentOutputHash,
  enrichIndex,
  resolveAIEnrichmentConfig,
} from "./ai-enrichment.js";
export type { AIEnrichmentConfig } from "./ai-enrichment.js";
export {
  validateSkillQuality,
  validateAdapterSpec,
  validateAllAdapterSpecs,
} from "./quality-gate.js";
export {
  detectLegacyGeneratedFiles,
  detectUnexpectedGeneratedFiles,
  detectAllLegacyAndUnexpected,
} from "./legacy-detection.js";
