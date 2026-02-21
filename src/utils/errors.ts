/**
 * Typed errors for CLI exit-code mapping.
 */

export class UserError extends Error {
  readonly name = "UserError";
}

export class SystemError extends Error {
  readonly name = "SystemError";
}

export class ProviderError extends Error {
  readonly name = "ProviderError";
}

export const isTypedError = (error: unknown): error is UserError | SystemError | ProviderError =>
  error instanceof UserError || error instanceof SystemError || error instanceof ProviderError;
