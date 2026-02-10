/**
 * Security & Filtering Demo
 *
 * This demo showcases the 3 layers of security implemented in mp-sentinel:
 * 1. Smart File Filtering (Layer 1)
 * 2. Secret Scrubbing (Layer 2)
 * 3. Transparency & Dry-Run (Layer 3)
 */

import { FileHandler } from "../src/services/file-handler.js";
import { SecurityService } from "../src/services/security.service.js";
import { log } from "../src/utils/logger.js";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";

const DEMO_DIR = resolve("demo-workspace");

async function setupDemoWorkspace() {
  if (existsSync(DEMO_DIR)) {
    await rm(DEMO_DIR, { recursive: true, force: true });
  }
  await mkdir(DEMO_DIR, { recursive: true });

  // Create some files to test filtering
  await writeFile(join(DEMO_DIR, "main.ts"), 'console.log("Hello World");');
  await writeFile(join(DEMO_DIR, "config.json"), '{ "version": "1.0.0" }');
  await writeFile(
    join(DEMO_DIR, ".env"),
    "API_KEY=AIzaSyA_something_secret\nDB_PASS=supersecret123",
  );
  await writeFile(
    join(DEMO_DIR, "id_rsa"),
    "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----",
  );
  await writeFile(join(DEMO_DIR, "package-lock.json"), "{}");
  await writeFile(join(DEMO_DIR, "notes.txt"), "Just some notes"); // Should be filtered by extension

  // Create a file with a variety of "secrets" to test redaction
  const contentWithSecrets = `
import { SecretsManager } from 'aws-sdk';

// This is a test file for redaction
const awsKey = "AKIAID80345678901234";
const awsSecret = "aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const gcpKey = "AIzaSyB_1234567890abcdefghijklmnopqrstuvw";
const dbUri = "postgresql://admin:password123@localhost:5432/mydb";
const token = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

function connect() {
  console.log("Connecting using " + awsKey);
}
  `;
  await writeFile(join(DEMO_DIR, "api-client.ts"), contentWithSecrets);

  // Create .gitignore
  await writeFile(
    join(DEMO_DIR, ".gitignore"),
    "ignored-file.ts\nnode_modules/",
  );
  await writeFile(
    join(DEMO_DIR, "ignored-file.ts"),
    'console.log("I should be ignored");',
  );
}

async function runDemo() {
  log.header("Starting Security & Filtering Demo");

  await setupDemoWorkspace();
  log.info(`Demo workspace created at: ${DEMO_DIR}`);

  // --- Layer 1: File Filtering ---
  const fileHandler = new FileHandler({ cwd: DEMO_DIR });
  const filterResult = await fileHandler.discoverFiles();

  fileHandler.printFilterResult(filterResult);

  // --- Layer 2 & 3: Secret Scrubbing & Transparency ---
  const securityService = new SecurityService();

  const filesToProcess = [];
  for (const relPath of filterResult.accepted) {
    const content = await readFile(join(DEMO_DIR, relPath), "utf-8");
    filesToProcess.push({ path: relPath, content });
  }

  // Sanitize content (Layer 2)
  const { sanitizedFiles } = securityService.sanitizeFiles(filesToProcess);

  // Generate Summary (Layer 3)
  const summary =
    securityService.generatePayloadSummaryFromContents(sanitizedFiles);
  securityService.printPayloadSummary(summary);

  log.header("Redaction Verification");
  const apiClient = sanitizedFiles.find((f) => f.path === "api-client.ts");
  if (apiClient) {
    log.info("Snippet of redacted api-client.ts:");
    const lines = apiClient.content
      .split("\n")
      .filter((l) => l.includes("<REDACTED_SECRET>"));
    for (const line of lines) {
      log.file(line.trim());
    }
  }

  log.success("Demo completed successfully!");

  // Cleanup
  await rm(DEMO_DIR, { recursive: true, force: true });
}

runDemo().catch((err) => {
  log.error(`Demo failed: ${err.message}`);
  process.exit(1);
});
