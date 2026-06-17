# MP Sentinel for VS Code

Runs the [`mp-sentinel`](../../README.md) CLI from inside VS Code: AI code review,
source-index health, and agent-skill generation — with findings surfaced in the
Problems panel.

This is the first UI adapter built on the IDE-agnostic
[`mp-sentinel-extension-core`](../../packages/mp-sentinel-extension-core). The core
holds all CLI/parsing logic so a future JetBrains/Zed adapter can reuse it.

## How it runs the CLI

The extension spawns `mp-sentinel` as a child process and parses its JSON output.
It does **not** call the CLI's internal APIs, so it stays compatible across CLI
versions as long as the JSON contract holds.

Configure the launcher with `mpSentinel.cli.command` / `mpSentinel.cli.baseArgs`:

- `npx` + `["mp-sentinel"]` (default) — uses the project's installed CLI.
- an absolute path to the binary, with `baseArgs` `[]`.
- `mp-sentinel` if it is on `PATH`, with `baseArgs` `[]`.

## Credentials & secrets

API keys and tokens are stored in VS Code **Secret Storage** via
`MP Sentinel: Set API Key / Token`. They are injected into the CLI process
environment at runtime and are **never** written to `.mp-sentinelrc.json`,
passed as command-line arguments, or printed to the output panel (CLI stderr is
redacted before display).

`.mp-sentinelrc.json` remains project configuration only (rules, limits,
indexing, review behavior, create-skills, MCP).

## Commands

- **Review Staged Changes / Current File / Selected File(s) / Git Range…**
- **Review Current Branch Against Base…** — reviews the current branch versus a
  base branch (prompted; default `origin/main`), writes a markdown report to
  `reports/review-MMDD.md`, and opens it. Findings flow to the Problems panel and
  the side panel.
- **Dry-Run Preview (no AI)** — deterministic security-only pass.
- **Explain Review Context** — context/token diagnostics for a file (no AI).
- **Source Index Health / Rebuild Source Index**
- **Check Agent Skills Freshness / Generate ⋅ Update Agent Skills**
- **Configure AI Provider…** — wizard to pick provider, an exact model or tier
  (mutually exclusive), optional Anthropic base URL (for Anthropic-compatible
  endpoints like DeepSeek) or OpenRouter attribution, and to store the provider's
  API key. Non-secret choices go to settings; the key goes to Secret Storage only.
- **Set / Clear API Key · Create .mp-sentinelrc.json**

All commands are also available from the **MP Sentinel side panel** in the
Activity Bar (Actions & Results).

## AI settings

Set via the **Configure AI Provider…** wizard or directly:

- `mpSentinel.ai.provider` / `mpSentinel.ai.model` / `mpSentinel.ai.modelTier`
- `mpSentinel.ai.anthropicBaseUrl` — custom Anthropic-compatible endpoint
  (injected as `ANTHROPIC_BASE_URL`; blank uses the official API).
- `mpSentinel.ai.openrouterSiteUrl` / `mpSentinel.ai.openrouterAppName` — optional
  OpenRouter attribution.

API keys are **never** stored in settings — only in VS Code Secret Storage.

## Branch-diff settings

- `mpSentinel.review.compareBranch` — default base branch (default `origin/main`).
- `mpSentinel.review.branchReportDirectory` — report directory (default `reports`).
- `mpSentinel.review.branchSeverityThreshold` — severity floor that fails the
  review: `CRITICAL` | `WARNING` | `INFO` (default `INFO`).

## Develop

The extension and its core are npm **workspaces** of the root `mp-sentinel`
repo, so install and build from the repo root (one install covers both):

```sh
# from the repo root
npm install                      # links workspaces; pulls @types/vscode + esbuild
npm run extension:check          # typecheck core + run core tests + typecheck extension
npm run extension:build          # build core, then esbuild-bundle the extension
```

Workspace-scoped scripts are also available from the root:

```sh
npm run extension:vscode:typecheck   # tsc --noEmit against @types/vscode
npm run extension:vscode:build       # esbuild bundle -> dist/extension.js (CJS)
```

You can still run the per-folder scripts (`npm run typecheck` / `npm run build`)
from inside `extensions/vscode` once the root install has linked the workspace.

The build bundles the ESM core into the CommonJS extension entry; `vscode` stays
external (provided by the host).
