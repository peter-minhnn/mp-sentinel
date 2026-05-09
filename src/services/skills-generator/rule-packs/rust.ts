/**
 * Rule pack for Rust projects
 */

import type { RulePack } from "./index.js";

export const rustRules: RulePack = {
  id: "rust",
  label: "Rust",
  when: (ctx) => {
    const hasRs =
      ctx.langProfile.distribution["rust"] !== undefined &&
      ctx.langProfile.distribution["rust"]! > 0;
    return hasRs;
  },
  rules: [
    {
      kind: "must",
      text: "Run `cargo clippy` and address all warnings before committing. Clippy is the canonical Rust linter.",
    },
    {
      kind: "should",
      text: "Use the `?` operator for error propagation instead of `unwrap()` or `expect()` in library code. Reserve `unwrap()` for tests and cases where failure is impossible.",
    },
    {
      kind: "avoid",
      text: "Do NOT use `unwrap()` or `expect()` in library/public API code. Return `Result` or `Option` and let callers decide how to handle errors.",
    },
    {
      kind: "must",
      text: "Use `cargo fmt` to format all Rust code. Rust has a canonical formatter (`rustfmt`).",
    },
    {
      kind: "should",
      text: "Prefer owned types (`String`, `Vec<T>`) in public APIs and use `&str`, `&[T]` for function parameters.",
    },
    {
      kind: "should",
      text: "Derive common traits (`Debug`, `Clone`, `Copy`, `PartialEq`, `Eq`) on public types where appropriate.",
    },
  ],
  fileGlobs: ["**/*.rs"],
};
