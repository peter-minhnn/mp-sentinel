/**
 * SecurityService - Re-exports from modular security service
 * @deprecated Import from './security/index.js' instead
 */

export {
  SecurityService,
  getSecurityService,
  resetSecurityService,
} from "./security/index.js";

export type {
  SecretPattern,
  SanitizationResult,
  SuspiciousKeyword,
  PayloadFileSummary,
  PayloadSummary,
} from "./security/index.js";
