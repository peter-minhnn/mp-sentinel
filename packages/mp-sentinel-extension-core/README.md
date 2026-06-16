# mp-sentinel-extension-core

IDE-agnostic core for MP Sentinel editor extensions. **No VS Code dependency** —
the first consumer is the VS Code adapter under `extensions/vscode`, but this
package can back a future JetBrains / Zed / Cursor adapter too.

## What it does

The extension talks to `mp-sentinel` as a black box: it spawns the CLI, injects
the right environment, and parses the JSON it writes to stdout. This package owns
that contract so UI code stays thin.

| Module | Responsibility |
|--------|----------------|
| `command-builder` | Build secret-free argv for review / explain-context / indexing / create-skills / init. |
| `env` | Build the child-process environment: non-secret AI selection, MCP vars, and secret credentials (last). |
| `secrets` | Canonical secret env-var list, redaction, and a no-leak-in-argv guard. |
| `runner` | Spawn the CLI, capture stdout/stderr/exit code, support timeout + cancellation. Injectable spawn for tests. |
| `parse` | Tolerant JSON extraction + typed parsers for each CLI output shape. |
| `normalize` | Flatten a `ReviewReport` into editor-agnostic findings for diagnostics. |
| `config` | Read/scaffold `.mp-sentinelrc.json` and assert it never contains a secret. |
| `service` | High-level facade tying the above together, with exit-code policy. |

## Secret policy (non-negotiable)

API keys and tokens are **never** written to `.mp-sentinelrc.json`, **never**
passed as CLI arguments, and **never** logged. They live in the host editor's
secret store (e.g. VS Code `SecretStorage`) and are injected into the child
process environment only. `assertNoSecretsInArgs` and `assertConfigHasNoSecrets`
enforce this.

## Exit-code policy

The CLI uses `0` = PASS, `1` = actionable findings, `2` = runtime error. The
runner returns the code verbatim; `MpSentinelService` treats `2` as an error
(rejects with `CliRuntimeError`) and `0`/`1` as parseable results.

## Develop

```sh
npm run typecheck   # tsc --noEmit
npm test            # compiles to dist-test/ then runs node --test
npm run build       # emit dist/
```

Tests use Node's built-in test runner and `*.spec.ts` names so the parent
`mp-sentinel` Jest config (which globs `*.test.ts`) never picks them up.
