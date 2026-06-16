/**
 * Built-in rule pack -- always-active evaluators that implement project-level
 * clean-code policies. Not tied to any specific language or framework.
 */

import type { RulePack } from "./index.js";
import { emptyCatch, fileTooLong, functionTooLong } from "./evaluators/clean-code-evaluators.js";

export const builtinRules: RulePack = {
  id: "builtin",
  label: "Built-in Policies",
  when: () => true, // Always active
  rules: [],
  fileGlobs: [],
  evaluators: [fileTooLong, functionTooLong, emptyCatch],
};
