/**
 * Retrieval metrics for compact `--search` vs the older find-* commands.
 * Ranked lists are file paths (first occurrence wins).
 */

export function uniqueRankedFiles(files: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const file of files) {
    if (seen.has(file)) continue;
    seen.add(file);
    out.push(file);
  }
  return out;
}

/** Empty relevant is a labeling error: score 0, never a perfect 1. */
export function recallAtK(
  ranked: readonly string[],
  relevant: readonly string[],
  k: number,
): number {
  if (relevant.length === 0) return 0;
  const top = new Set(uniqueRankedFiles(ranked).slice(0, k));
  let hit = 0;
  for (const file of relevant) {
    if (top.has(file)) hit += 1;
  }
  return hit / relevant.length;
}

export function meanReciprocalRank(ranked: readonly string[], relevant: readonly string[]): number {
  if (relevant.length === 0) return 0;
  const want = new Set(relevant);
  const files = uniqueRankedFiles(ranked);
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file && want.has(file)) return 1 / (i + 1);
  }
  return 0;
}

export function top1Hit(ranked: readonly string[], relevant: readonly string[]): boolean {
  const first = uniqueRankedFiles(ranked)[0];
  return first !== undefined && relevant.includes(first);
}

export function payloadBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf-8");
}

export function estimateTokens(bytes: number): number {
  return Math.ceil(bytes / 4);
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[idx] ?? 0;
}

export function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}
