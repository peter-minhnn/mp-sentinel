/**
 * Rule pack for NestJS projects.
 *
 * NestJS is a decorator/DI-based Node server framework. Unlike Angular it uses
 * constructor-based injection as the idiomatic default, so the rules here codify
 * NestJS's *standard* architecture (thin controllers, providers/modules, DTO
 * validation, guards/interceptors/filters). A clear standard baseline is also
 * what lets the evaluators flag deviations in non-idiomatic codebases.
 *
 * Detection is via the scoped packages (`@nestjs/core` / `@nestjs/common`) --
 * there is no bare `nestjs` package on npm.
 */

import type { RulePack, FileEvaluator, FileEvaluatorResult } from "./index.js";

type Severity = FileEvaluatorResult["severity"];

const mk = (
  ruleId: string,
  message: string,
  line: number,
  severity: Severity,
  suggestion: string,
): FileEvaluatorResult => ({
  ruleId,
  passed: false,
  message,
  line,
  column: 0,
  severity,
  suggestion,
});

const isController = (filePath: string): boolean => /\.controller\.ts$/.test(filePath);

/**
 * Evaluator: controllers should delegate persistence to services. Direct
 * repository / query-builder access inside a controller is a NestJS layering
 * violation (business logic leaking into the transport layer).
 */
const noDataAccessInController: FileEvaluator = {
  // The pack id ("nestjs") is prepended by the evaluator runner, so this is
  // the bare rule id -- the emitted finding id is `nestjs/no-data-access-in-controller`.
  ruleId: "no-data-access-in-controller",
  evaluate: ({ filePath, lines }) => {
    if (!isController(filePath)) return [];
    const results: FileEvaluatorResult[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (
        /@InjectRepository\s*\(/.test(line) ||
        /\.createQueryBuilder\s*\(/.test(line) ||
        /\.getRepository\s*\(/.test(line)
      ) {
        results.push(
          mk(
            "no-data-access-in-controller",
            "Controller accesses the data layer directly (repository/query builder). Controllers should stay thin and delegate to a provider/service.",
            i + 1,
            "WARNING",
            "Move the persistence logic into an `@Injectable()` service and call it from the controller.",
          ),
        );
      }
    }
    return results;
  },
};

/**
 * Evaluator: `@Body()` parameters should be typed with a DTO class so that
 * class-validator/ValidationPipe can run. `any` / `object` payloads bypass
 * validation entirely.
 */
const bodyMustBeTypedDto: FileEvaluator = {
  ruleId: "body-must-be-typed-dto",
  evaluate: ({ filePath, lines }) => {
    if (!isController(filePath)) return [];
    const results: FileEvaluatorResult[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // @Body() payload: any  /  @Body('x') payload: object
      if (/@Body\s*\([^)]*\)\s*\w+\s*:\s*(any|object|unknown)\b/.test(line)) {
        results.push(
          mk(
            "body-must-be-typed-dto",
            "Request body is typed as `any`/`object`/`unknown`, so validation cannot run. Use a DTO class with class-validator decorators.",
            i + 1,
            "WARNING",
            "Declare a DTO class (e.g. `CreateFooDto`) with class-validator decorators and a global `ValidationPipe`.",
          ),
        );
      }
    }
    return results;
  },
};

export const nestjsRules: RulePack = {
  id: "nestjs",
  label: "NestJS",
  when: (ctx) =>
    ctx.deps["@nestjs/core"] !== undefined ||
    ctx.deps["@nestjs/common"] !== undefined ||
    ctx.frameworks.includes("nestjs"),
  rules: [
    // ── Standard architecture (stable across majors) ────────────────────────
    {
      kind: "must",
      id: "nestjs/thin-controllers",
      text: "Keep controllers thin: they should only handle routing, request/response shaping, and delegation. Put business logic and persistence in `@Injectable()` providers (services).",
    },
    {
      kind: "must",
      id: "nestjs/dto-validation",
      text: "Validate request payloads with DTO classes decorated by class-validator, enforced by a global `ValidationPipe`. Never accept untyped (`any`) bodies.",
    },
    {
      kind: "must",
      id: "nestjs/constructor-di",
      text: "Use constructor-based dependency injection with `@Injectable()` providers. Do not instantiate providers with `new` or reach into the DI container manually.",
    },
    {
      kind: "should",
      id: "nestjs/module-boundaries",
      text: "Organize by feature module: declare `controllers`, `providers`, `imports`, and `exports` explicitly. One responsibility per module; only export what other modules consume.",
    },
    {
      kind: "should",
      id: "nestjs/cross-cutting-primitives",
      text: "Use NestJS primitives for cross-cutting concerns -- Guards (authz), Interceptors (transform/logging), Pipes (validation/transform), and Exception Filters -- instead of ad-hoc logic inside controllers/services.",
    },
    {
      kind: "should",
      id: "nestjs/http-exceptions",
      text: "Signal errors with built-in `HttpException` subclasses (e.g. `NotFoundException`, `BadRequestException`) and centralize handling in exception filters, rather than returning raw error objects or status codes.",
    },
    {
      kind: "should",
      id: "nestjs/config-module",
      text: "Read configuration through `ConfigModule`/`ConfigService` rather than scattering `process.env.*` access across services.",
    },
    {
      kind: "avoid",
      id: "nestjs/no-circular-modules",
      text: "Avoid circular dependencies between modules/providers. Restructure shared code into a common module; reserve `forwardRef()` for genuinely unavoidable cycles.",
    },
    // ── Version-gated: only surfaces on the major that actually applies ──────
    {
      kind: "should",
      id: "nestjs/express5-paths",
      requires: [{ dep: "@nestjs/core", minMajor: 11 }],
      text: "NestJS v11 runs on Express 5: wildcard route paths must be named (e.g. `*splat` instead of a bare `*`), and some path-matching semantics changed. Update wildcard routes accordingly.",
    },
    {
      kind: "avoid",
      id: "nestjs/legacy-node-apis",
      requires: [{ dep: "@nestjs/core", maxMajor: 9 }],
      text: "This project is on NestJS v9 (Express 4). Do not introduce v10+/v11-only APIs or Express 5 path syntax -- they are not available on this major. Match the patterns already present in the codebase.",
    },
  ],
  fileGlobs: ["**/*.ts"],
  evaluators: [noDataAccessInController, bodyMustBeTypedDto],
};
