/**
 * Source Index Service - Main entry point
 * Re-exports all source indexing functionality
 */

export {
  readManifest,
  detectPackageManager,
  extensionToLanguage,
  isIndexableLanguage,
  isLexicallyExtractableLanguage,
  computeManifestHash,
} from "./manifest.js";
export { parseFile, isLanguageSupported } from "./parser.js";
export {
  readIndex,
  writeIndex,
  validateCache,
  getFilesToIndex,
  calculateSHA256,
} from "./storage.js";
export { querySymbols, queryImports, queryAgentContext } from "./query.js";
export type { SymbolResult, ImportResult, AgentContextResult } from "./query.js";
