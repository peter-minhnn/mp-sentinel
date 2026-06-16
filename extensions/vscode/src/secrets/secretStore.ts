import * as vscode from "vscode";
import { SECRET_ENV_KEYS, sanitizeSecretBundle, type SecretBundle, type SecretEnvKey } from "mp-sentinel-extension-core";

/**
 * Stores provider credentials in VS Code SecretStorage, keyed by the exact
 * environment variable name the CLI expects. Nothing here ever touches
 * workspace settings or `.mp-sentinelrc.json`.
 *
 * Keys are namespaced so they never collide with other extensions' secrets.
 */
export class SecretStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  private storageKey(key: SecretEnvKey): string {
    return `mpSentinel.secret.${key}`;
  }

  async get(key: SecretEnvKey): Promise<string | undefined> {
    return this.secrets.get(this.storageKey(key));
  }

  async set(key: SecretEnvKey, value: string): Promise<void> {
    await this.secrets.store(this.storageKey(key), value);
  }

  async clear(key: SecretEnvKey): Promise<void> {
    await this.secrets.delete(this.storageKey(key));
  }

  /** Collects all stored secrets into a sanitized bundle for env injection. */
  async getBundle(): Promise<SecretBundle> {
    const raw: Record<string, string | undefined> = {};
    await Promise.all(
      SECRET_ENV_KEYS.map(async (key) => {
        raw[key] = await this.get(key);
      }),
    );
    return sanitizeSecretBundle(raw);
  }

  /** Returns the secret keys that currently hold a value. */
  async listConfigured(): Promise<SecretEnvKey[]> {
    const bundle = await this.getBundle();
    return SECRET_ENV_KEYS.filter((key) => bundle[key] !== undefined);
  }
}
