/**
 * Bounded-concurrency parallel map for the indexing pipeline (Phase 3.1).
 *
 * Tree-sitter's parse() call is synchronous, but the surrounding work
 * (readFile, sha256, mtime stat) is I/O-bound and async. Running N file
 * pipelines in flight overlaps that I/O wait so the wall-clock time drops
 * significantly even on a single CPU core. We don't use worker threads
 * here because tree-sitter's native bindings can't be cheaply shipped to
 * workers and the per-file CPU cost is low enough that the IPC overhead
 * would dominate.
 *
 * Concurrency is bounded by `availableParallelism()` (capped at 8) so we
 * don't open more than the OS can usefully schedule.
 */

import { availableParallelism } from "node:os";

const DEFAULT_CONCURRENCY_CAP = 8;

export const defaultIndexingConcurrency = (): number => {
  try {
    return Math.min(availableParallelism(), DEFAULT_CONCURRENCY_CAP);
  } catch {
    return 4;
  }
};

/**
 * Like Promise.all(items.map(fn)) but never runs more than `concurrency`
 * tasks in flight. Preserves input order in the returned array.
 *
 * Tasks that throw are caught and the error is propagated as a rejected
 * promise from this function (matching Promise.all semantics).
 */
export const parallelMap = async <T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number = defaultIndexingConcurrency(),
): Promise<R[]> => {
  const effective = Math.max(1, Math.floor(concurrency));
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = nextIndex++;
      if (i >= items.length) return;
      const item = items[i] as T;
      results[i] = await fn(item, i);
    }
  };

  const workers: Promise<void>[] = [];
  const workerCount = Math.min(effective, items.length);
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
};
