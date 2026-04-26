/**
 * Source Index Service - Main entry point
 * Re-exports all source indexing functionality
 */

export {
  readManifest,
  detectPackageManager,
  extensionToLanguage,
  isIndexableLanguage,
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
