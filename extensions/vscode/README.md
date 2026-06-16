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
- **Dry-Run Preview (no AI)** — deterministic security-only pass.
- **Explain Review Context** — context/token diagnostics for a file (no AI).
- **Source Index Health / Rebuild Source Index**
- **Check Agent Skills Freshness / Generate ⋅ Update Agent Skills**
- **Set / Clear API Key · Select Provider & Model Tier · Create .mp-sentinelrc.json**

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
