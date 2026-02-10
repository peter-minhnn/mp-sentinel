/**
 * File service with streaming support and memory optimization
 */

import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { log } from '../utils/logger.js';
import { formatBytes } from '../utils/parser.js';

const MAX_FILE_SIZE = 500 * 1024; // 500KB limit per file

export interface FileContent {
  path: string;
  content: string;
  size: number;
}

interface SkippedFile {
  path: string;
  skipped: true;
  reason: string;
}

interface ReadFile {
  path: string;
  content: string;
  size: number;
  skipped: false;
}

type FileReadItem = SkippedFile | ReadFile;

export interface FileReadResult {
  success: FileContent[];
  skipped: Array<{ path: string; reason: string }>;
}

/**
 * Read multiple files efficiently with size limits
 * PERFORMANCE: Uses Promise.allSettled for true parallel processing
 * ERROR HANDLING: Failed files don't stop the entire process
 */
export const readFilesForAudit = async (filePaths: string[]): Promise<FileReadResult> => {
  const result: FileReadResult = {
    success: [],
    skipped: [],
  };

  const readPromises = filePaths.map(async (filePath): Promise<FileReadItem> => {
    const absolutePath = resolve(filePath);
    
    // Check existence
    if (!existsSync(absolutePath)) {
      return { path: filePath, skipped: true, reason: 'File not found' };
    }

    try {
      // Check file size first
      const stats = await stat(absolutePath);
      
      if (stats.size > MAX_FILE_SIZE) {
        return { 
          path: filePath, 
          skipped: true, 
          reason: `File too large (${formatBytes(stats.size)})` 
        };
      }

      // Read file content
      const content = await readFile(absolutePath, 'utf-8');
      
      return {
        path: filePath,
        content,
        size: stats.size,
        skipped: false,
      };
    } catch (error) {
      return { 
        path: filePath, 
        skipped: true, 
        reason: error instanceof Error ? error.message : 'Read error' 
      };
    }
  });

  // Use Promise.allSettled to ensure all files are processed
  const settledResults = await Promise.allSettled(readPromises);

  for (const promiseResult of settledResults) {
    if (promiseResult.status === 'fulfilled') {
      const item = promiseResult.value;
      
      if (item.skipped) {
        result.skipped.push({ path: item.path, reason: item.reason });
      } else {
        result.success.push({
          path: item.path,
          content: item.content,
          size: item.size,
        });
      }
    } else {
      // Promise rejected unexpectedly
      log.error(`Unexpected file read error: ${promiseResult.reason}`);
    }
  }

  // Log skipped files
  if (result.skipped.length > 0) {
    log.warning(`⚠️  Skipped ${result.skipped.length} file(s):`);
    for (const { path, reason } of result.skipped) {
      log.file(`   ❌ ${path}: ${reason}`);
    }
  }

  return result;
};

/**
 * Get file extension without dot
 */
export const getFileExtension = (filePath: string): string => {
  const match = filePath.match(/\.([^.]+)$/);
  return match?.[1] ?? '';
};

/**
 * Check if file is a code file
 */
export const isCodeFile = (filePath: string): boolean => {
  const codeExtensions = new Set([
    'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
    'py', 'cs', 'go', 'java', 'rs', 'kt', 'swift',
    'cpp', 'c', 'h', 'hpp', 'rb', 'php'
  ]);
  return codeExtensions.has(getFileExtension(filePath));
};

// Re-export formatBytes for convenience
export { formatBytes };
