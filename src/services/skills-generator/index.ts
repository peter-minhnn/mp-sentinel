export { generateContent } from "./content.js";
export type { GeneratedContent, SkillSections } from "./content.js";
export { ADAPTER_REGISTRY, getAdapter, parseAgentFlag, detectAdapters } from "./registry.js";
export {
  computeIndexHash,
  renderMetadataHeader,
  parseMetadataFromContent,
  applyMetadataHeader,
} from "./metadata.js";
export type { SkillsMetadata } from "./metadata.js";
export { detectProfile } from "./profile.js";
export type { SkillProfile } from "./profile.js";
