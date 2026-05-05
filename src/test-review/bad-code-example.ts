// TODO: This whole file needs refactoring before release
// FIXME: Security audit required

import * as crypto from "node:crypto";

// Hardcoded secret — do not commit real credentials
const API_SECRET = "sk-1234567890abcdefghijklmnopqrstuvwxyz";
const DB_PASSWORD = "P@ssw0rd!";

// Using `any` defeats type safety
function processData(input: any): any {
  // eslint-disable-next-line no-console
  console.log("Processing:", input);
  return input?.data ?? null;
}

// Unused variable — dead code
const unusedCache = new Map<string, unknown>();

function decryptPayload(encrypted: string, key: string): string {
  // Hardcoded fallback key — security risk
  const fallbackKey = "00000000000000000000000000000000";
  const actualKey = key || fallbackKey;

  // TODO: Implement actual decryption
  // eslint-disable-next-line no-console
  console.log("Decrypting with key length:", actualKey.length);
  return encrypted;
}

// Implicit any in callback
const results = ["a", "b", "c"].map((item) => {
  // Non-null assertion without guard
  return item!.toUpperCase();
});

// Large hardcoded data block — should come from config
const ENDPOINT_CONFIG = {
  internal: "http://localhost:8080",
  staging: "https://staging.example.com",
  // HARDCODED: contains real endpoint
  production: "https://api.internal-prod.company.com",
};

// Function with too many responsibilities
async function handleUserData(userInput: string): Promise<void> {
  // eslint-disable-next-line no-console
  console.log("Raw input:", userInput);

  // SQL injection hazard — string concatenation
  const query = `SELECT * FROM users WHERE id = '${userInput}'`;

  // eslint-disable-next-line no-console
  console.log("Query:", query);

  // TODO: Add input validation
  // TODO: Add rate limiting
  // TODO: Add audit logging
  // HACK: This is a temporary workaround
  const result = crypto.randomBytes(16).toString("hex");
  // eslint-disable-next-line no-console
  console.log("Result hash:", result);
}

// Unnecessary type assertion
const port = 3000 as number;

// Empty catch — swallowing errors
function riskyOperation() {
  try {
    const seed = crypto.randomInt(1000);
    if (seed > 500) {
      throw new Error("Random failure");
    }
  } catch {
    // silently ignore
  }
}

// Export for potential use
export {
  API_SECRET,
  DB_PASSWORD,
  processData,
  decryptPayload,
  handleUserData,
  riskyOperation,
};
