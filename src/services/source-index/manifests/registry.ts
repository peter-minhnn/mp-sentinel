/**
 * Manifest reader registry.
 *
 * Maintains an ordered list of ManifestReaders. Detection runs in priority
 * order: the first reader whose detect() returns true is used. Falls back
 * to the Node reader if nothing else matches (since package.json is the
 * most common manifest format and also the tool's own ecosystem).
 *
 * Priority order: Python, Go, Rust (explicit ecosystems detect first),
 * then Node as the default fallback.
 */

import type { ManifestReader, ProjectManifest } from "./types.js";
import type { Ecosystem } from "../../../types/index.js";
import { nodeReader } from "./node.reader.js";
import { pythonReader } from "./python.reader.js";
import { goReader } from "./go.reader.js";
import { rustReader } from "./rust.reader.js";
import { dartReader } from "./dart.reader.js";
import { phpReader } from "./php.reader.js";
import { rubyReader } from "./ruby.reader.js";

// Ordered list of readers. Higher-priority readers go first.
// The Node reader is always last as the default fallback.
const READERS: ManifestReader[] = [
  dartReader,
  phpReader,
  rubyReader,
  pythonReader,
  goReader,
  rustReader,
  nodeReader,
];

/**
 * Detect which reader applies to the given project root.
 * Returns the first matching reader, or the Node reader as default.
 */
export function detectReader(projectRoot: string): ManifestReader {
  for (const reader of READERS) {
    if (reader.detect(projectRoot)) {
      return reader;
    }
  }
  return nodeReader;
}

/**
 * Detect the ecosystem type for a project root.
 */
export function detectEcosystem(projectRoot: string): Ecosystem {
  const reader = detectReader(projectRoot);
  return reader.id as Ecosystem;
}

/**
 * Read the project manifest using the detected reader.
 */
export async function readManifest(projectRoot: string): Promise<ProjectManifest> {
  const reader = detectReader(projectRoot);
  const manifest = await reader.read(projectRoot);
  return manifest;
}

export { type ManifestReader } from "./types.js";
