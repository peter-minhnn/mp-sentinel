/**
 * Parsing utilities for AI responses
 */

import type { AuditResult } from '../types/index.js';

/**
 * Clean JSON from markdown code blocks
 */
export const cleanJSON = (text: string): string => {
  return text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();
};

/**
 * Parse AI response to AuditResult with error handling
 */
export const parseAuditResponse = (responseText: string): AuditResult => {
  const cleaned = cleanJSON(responseText);
  
  try {
    const parsed = JSON.parse(cleaned) as AuditResult;
    
    // Validate required fields
    if (!parsed.status || !['PASS', 'FAIL'].includes(parsed.status)) {
      return {
        status: 'FAIL',
        message: 'Invalid AI response format',
        issues: [],
      };
    }
    
    return parsed;
  } catch {
    // Try to extract JSON from the response
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]) as AuditResult;
      } catch {
        // Fall through to error response
      }
    }
    
    return {
      status: 'FAIL',
      message: 'Failed to parse AI response',
      issues: [],
    };
  }
};

/**
 * Format file size for display
 */
export const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

/**
 * Format duration for display
 */
export const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
};
