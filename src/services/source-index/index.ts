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
export { querySymbols, queryImports } from "./query.js";
export type { SymbolResult, ImportResult } from "./query.js";
export { queryAgentContext } from "./agent-context-evidence.js";
export type { AgentContextResult } from "./agent-context-evidence.js";
export {
  queryFiles,
  queryUnifiedSearch,
  clampSearchLimit,
  DEFAULT_SEARCH_LIMIT,
  DEFAULT_FIND_LIMIT,
} from "./agent-search.js";
export type { CompactSearchHit, CompactSearchResult, SearchHitKind } from "./agent-search.js";
export { stringifyIndexJson, stringifyCompactJson, emitIndexJson } from "./json-output.js";
export { buildTaskContext, extractTaskAnchors } from "./task-context.js";
export type { TaskContextResult, TaskContextFile } from "./task-context.js";
