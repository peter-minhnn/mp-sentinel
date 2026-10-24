import type {
  ProjectManifest,
  SourceIndexFile,
  IndexInsights,
  SourceIndexSidecars,
} from "./index.js";

/**
 * Source index schema v1.0 - v1.5
 */
export interface SourceIndex {
  schemaVersion: "1.0" | "1.1" | "1.2" | "1.3" | "1.4" | "1.5";
  generatedAt: string;
  toolVersion: string;
  /** Extraction rules used to build this cache; older caches omit this field. */
  extractorVersion?: number;
  project: ProjectManifest;
  files: SourceIndexFile[];
  /** Deterministic hash of manifest inputs (package.json, tsconfig, lockfile). Absent = manifest-stale. */
  manifestHash?: string;
  /**
   * Git HEAD SHA at index time (Phase 3.1). Used by `indexing --health` to
   * report drift between the indexed snapshot and the current working tree.
   * Absent when the project root isn't a git repo.
   */
  gitHeadSha?: string;
  stats: {
    totalFiles: number;
    indexedFiles: number;
    skippedFiles: number;
    parseErrors: number;
    /** Duration of indexing in milliseconds */
    durationMs?: number;
    /** Number of files served from cache */
    cacheHitFiles?: number;
    /** Number of files parsed in this session */
    parsedFiles?: number;
    /** Number of import edges resolved in dependency graph (optional) */
    importEdges?: number;
  };
  /** Index insights (schema 1.2+) */
  insights?: IndexInsights;
  /** Sidecar layout metadata (schema 1.5 light cache mode only). */
  sidecars?: SourceIndexSidecars;
}
