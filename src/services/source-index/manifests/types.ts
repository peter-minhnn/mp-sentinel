/**
 * Manifest reader types — abstraction over ecosystem-specific project manifests.
 *
 * Each ecosystem (Node, Python, Go, Rust, etc.) has its own manifest file
 * format. A ManifestReader detects whether its manifest exists in a project
 * and reads it into the unified ProjectManifest shape.
 */

import type { ProjectManifest } from "../../../types/index.js";

export type { ProjectManifest };

/**
 * A manifest reader for a specific ecosystem.
 * Readers are ordered by detection priority in the registry.
 */
export interface ManifestReader {
  /** Unique identifier (e.g. "node", "python", "go") */
  id: string;
  /** Returns true if this reader's manifest exists at projectRoot */
  detect(projectRoot: string): boolean;
  /** Read the manifest and return a unified ProjectManifest */
  read(projectRoot: string): Promise<ProjectManifest>;
}
