/**
 * Rule pack for Go projects
 */

import type { RulePack } from "./index.js";

export const goRules: RulePack = {
  id: "go",
  label: "Go",
  when: (ctx) => {
    const hasGo =
      ctx.langProfile.distribution["go"] !== undefined && ctx.langProfile.distribution["go"]! > 0;
    return hasGo;
  },
  rules: [
    {
      kind: "must",
      text: "Run `gofmt` or `go fmt` on all `.go` files before committing. Go has a single canonical formatting style enforced by the toolchain.",
    },
    {
      kind: "must",
      text: "Handle all errors explicitly. Never use `_` to discard an error unless the docs explicitly say the error is always nil.",
    },
    {
      kind: "should",
      text: "Return errors to callers rather than panicking. Panics should only be used for truly unrecoverable states (e.g., failed init).",
    },
    {
      kind: "avoid",
      text: "Do NOT use `init()` functions for anything other than package-level registration. Prefer explicit initialization.",
    },
    {
      kind: "should",
      text: "Use `context.Context` as the first parameter in functions that make I/O calls or may need cancellation/timeouts.",
    },
    {
      kind: "must",
      text: "Follow Go's naming conventions: CamelCase for exported names, camelCase for unexported, acronyms all-uppercase (e.g., `HTTPServer`, not `HttpServer`).",
    },
  ],
  fileGlobs: ["**/*.go"],
};
