/**
 * Rule pack for Angular projects
 */

import type { RulePack, FileEvaluator } from "./index.js";

/**
 * Evaluator: detect constructor-based dependency injection (Angular v17+ prefers inject())
 */
const constructorInjection: FileEvaluator = {
  ruleId: "prefer-inject",
  evaluate: ({ filePath, lines }) => {
    if (!filePath.endsWith(".ts")) return [];
    const results: Array<{
      ruleId: string;
      passed: boolean;
      message: string;
      line: number;
      column: number;
      severity: "CRITICAL" | "WARNING" | "INFO";
      suggestion: string;
    }> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // Check for constructor(private service: FooService) pattern
      if (/constructor\s*\([^)]*(?:private|public|protected)\s+\w+\s*:/.test(line)) {
        results.push({
          ruleId: "prefer-inject",
          passed: false,
          message:
            "Constructor-based dependency injection detected. Angular v17+ prefers the `inject()` function.",
          line: i + 1,
          column: 0,
          severity: "INFO",
          suggestion:
            "Replace `constructor(private service: FooService)` with `private readonly service = inject(FooService)`.",
        });
      }
    }

    return results;
  },
};

export const angularRules: RulePack = {
  id: "angular",
  label: "Angular",
  when: (ctx) => {
    const hasAngularDep =
      ctx.deps["@angular/core"] !== undefined || ctx.deps["@angular/common"] !== undefined;
    return hasAngularDep;
  },
  rules: [
    {
      kind: "must",
      text: "Use `inject()` for dependency injection in Angular v17+ instead of constructor-based injection. This improves tree-shaking and testability.",
    },
    {
      kind: "should",
      text: "Prefer standalone components over NgModules. Standalone components are the default in Angular v17+ and produce smaller bundles.",
    },
    {
      kind: "should",
      text: "Use signals (`signal()`, `computed()`, `effect()`) for reactivity instead of `Observable`/`Subject` patterns where possible. Signals are simpler and have better change detection.",
    },
    {
      kind: "must",
      text: "Use `OnPush` change detection strategy for components that use signals. This reduces change detection cycles and improves performance.",
    },
    {
      kind: "avoid",
      text: "Do NOT use `async` pipes with `NgIf`/`NgFor` for complex async data flows. Prefer signals and computed values for template data.",
    },
    {
      kind: "should",
      text: "Use Angular's built-in control flow (`@if`, `@for`, `@switch`) instead of `*ngIf`, `*ngFor`, `*ngSwitch` structural directives in Angular v17+.",
    },
  ],
  fileGlobs: ["**/*.ts", "**/*.html"],
  evaluators: [constructorInjection],
};
