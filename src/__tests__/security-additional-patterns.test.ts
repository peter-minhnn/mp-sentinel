/**
 * Unit tests for the secret patterns added in Phase 2.2 (Anthropic, OpenAI,
 * Azure, Twilio, SendGrid, Datadog, Postman, Shopify, Square, GCP service
 * accounts).
 *
 * Each test sanitises a string containing a representative example and
 * asserts the matched pattern name plus that the secret is redacted in the
 * sanitised output.
 */

import { describe, expect, it } from "@jest/globals";
import { SecurityService } from "../services/security/index.js";
import { REDACTION_MARKER } from "../services/security/patterns.js";

const svc = new SecurityService();

const expectRedacted = (input: string, patternName: string): void => {
  const result = svc.sanitizeContent(input);
  expect(result.matchedPatterns).toContain(patternName);
  expect(result.content).toContain(REDACTION_MARKER);
  expect(result.content).not.toContain(input);
};

describe("Phase 2.2 — Anthropic", () => {
  it("redacts a sk-ant-api03-… key", () => {
    const key = "sk-ant-api03-" + "A".repeat(95);
    expectRedacted(`const k = "${key}";`, "Anthropic API Key");
  });

  it("redacts a sk-ant-admin01-… admin key", () => {
    const key = "sk-ant-admin01-" + "B".repeat(95);
    expectRedacted(`ANTHROPIC_ADMIN_KEY=${key}`, "Anthropic API Key");
  });
});

describe("Phase 2.2 — OpenAI", () => {
  it("redacts a legacy 51-char sk-… key", () => {
    const key = "sk-" + "x".repeat(48);
    expectRedacted(`OPENAI_API_KEY=${key}`, "OpenAI API Key");
  });

  it("redacts a sk-proj-… project key", () => {
    const key = "sk-proj-" + "y".repeat(50);
    expectRedacted(`const k = "${key}";`, "OpenAI API Key");
  });

  it("redacts a sk-svcacct-… service-account key", () => {
    const key = "sk-svcacct-" + "z".repeat(50);
    expectRedacted(`const k = "${key}";`, "OpenAI API Key");
  });

  it("does not redact short sk- strings (not a real key)", () => {
    const input = "const tag = 'sk-12345';";
    const result = svc.sanitizeContent(input);
    expect(result.matchedPatterns).not.toContain("OpenAI API Key");
  });
});

describe("Phase 2.2 — Azure", () => {
  it("redacts an Azure storage connection string", () => {
    const conn =
      "DefaultEndpointsProtocol=https;AccountName=foo;AccountKey=abc123=;EndpointSuffix=core.windows.net";
    const result = svc.sanitizeContent(conn);
    expect(result.matchedPatterns).toContain("Azure Storage Connection String");
    expect(result.redactedCount).toBeGreaterThan(0);
  });

  it("redacts an Azure SAS sig parameter", () => {
    const url =
      "https://example.blob.core.windows.net/c/b?sv=2021&sig=abcdef0123456789ABCDEF%2Fxyz&se=2030";
    expectRedacted(url, "Azure SAS Token");
  });
});

describe("Phase 2.2 — Twilio", () => {
  it("redacts a Twilio API SID (SK + 32 hex)", () => {
    const sk = "SK" + "0".repeat(32);
    expectRedacted(`const sid = "${sk}";`, "Twilio API Key");
  });

  it("redacts a Twilio Account SID (AC + 32 hex)", () => {
    const ac = "AC" + "f".repeat(32);
    expectRedacted(`account = "${ac}";`, "Twilio Account SID");
  });
});

describe("Phase 2.2 — SendGrid", () => {
  it("redacts a SendGrid API key", () => {
    const key = "SG." + "a".repeat(22) + "." + "b".repeat(43);
    expectRedacted(`SENDGRID_API_KEY=${key}`, "SendGrid API Key");
  });
});

describe("Phase 2.2 — Datadog", () => {
  it("redacts a Datadog API key (dda_…)", () => {
    const key = "ddp_" + "1".repeat(32);
    expectRedacted(`DD_API_KEY=${key}`, "Datadog API/App Key");
  });
});

describe("Phase 2.2 — Postman", () => {
  it("redacts a Postman API key (PMAK-…)", () => {
    const key = "PMAK-" + "a".repeat(24) + "-" + "b".repeat(34);
    expectRedacted(`POSTMAN_API_KEY=${key}`, "Postman API Key");
  });
});

describe("Phase 2.2 — Shopify / Square", () => {
  it("redacts a Shopify access token (shpat_…)", () => {
    const tok = "shpat_" + "a".repeat(32);
    expectRedacted(`SHOPIFY_TOKEN=${tok}`, "Shopify Access Token");
  });

  it("redacts a Square access token (EAAA…)", () => {
    const tok = "EAAA" + "x".repeat(60);
    expectRedacted(`SQUARE_TOKEN=${tok}`, "Square Access Token");
  });
});

describe("Phase 2.2 — GCP service account", () => {
  it("redacts a private_key_id + private_key block", () => {
    const json = `{
      "type": "service_account",
      "private_key_id": "abcdef0123456789abcdef01",
      "private_key": "-----BEGIN PRIVATE KEY-----\\nMIIEvAIBADANBgkq\\n-----END PRIVATE KEY-----\\n"
    }`;
    const result = svc.sanitizeContent(json);
    expect(result.matchedPatterns).toContain("GCP Service Account private_key block");
    expect(result.redactedCount).toBeGreaterThan(0);
  });
});

describe("Phase 2.2 — non-collision sanity checks", () => {
  it("does not redact a normal TypeScript identifier", () => {
    const code = `export const someConstant = 42;`;
    const result = svc.sanitizeContent(code);
    expect(result.redactedCount).toBe(0);
  });

  it("does not redact an HTTP URL", () => {
    const code = `const u = "https://example.com/api/v1/users";`;
    const result = svc.sanitizeContent(code);
    // The URL itself isn't a secret; the Database URI pattern is scoped
    // to mongodb/postgres/etc.
    expect(result.matchedPatterns).not.toContain("OpenAI API Key");
    expect(result.matchedPatterns).not.toContain("Anthropic API Key");
  });
});
