/**
 * Test component with intentional issues for CI audit testing.
 * DO NOT USE IN PRODUCTION.
 */

import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// SECURITY: Hardcoded API keys and secrets
const API_KEY = "sk-proj-abc123def456ghi789jklmno";
const DB_PASSWORD = "admin123!@#super-secret";
const JWT_SECRET = "my-insecure-jwt-secret-do-not-use";
const AWS_ACCESS_KEY = "AKIAIOSFODNN7EXAMPLE";
const AWS_SECRET_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const GEMINI_KEY = "AIzaSyDxV5kO9h8qR3aLm7nZp2YwTfBc1eG4jK6I";

// CODE QUALITY: Use of var, any types
var globalState: any = {};

// SECURITY: SQL Injection via string concatenation
function getUserByUsername(username: string) {
  const query = `SELECT * FROM users WHERE username = '${username}'`;
  return executeQuery(query);
}

// SECURITY: SQL Injection via string interpolation
function deleteUser(userId: string) {
  const sql = `DELETE FROM users WHERE id = ${userId};`;
  return executeQuery(sql);
}

// STUB: Simulate database query
function executeQuery(query: string): string {
  console.log("[DB] Executing query:", query);
  return "ok";
}

// SECURITY: XSS via innerHTML
function renderUserProfile(user: { name: string; bio: string }) {
  return `
    <div class="profile">
      <h1>${user.name}</h1>
      <p>${user.bio}</p>
    </div>
  `;
}

// SECURITY: Use of eval
function executeDynamicCode(code: string) {
  eval(code);
}

// SECURITY: Command injection via child_process
function pingHost(host: string): string {
  return execSync(`ping -c 4 ${host}`, { encoding: "utf-8" });
}

// SECURITY: Weak hashing algorithm (MD5)
function hashPassword(password: string): string {
  return createHash("md5").update(password).digest("hex");
}

// SECURITY: Path traversal risk
function readUserFile(filename: string): string {
  return readFileSync(`./uploads/${filename}`, "utf-8");
}

// CODE QUALITY: TypeScript `any` abuse
function processData(data: any): any {
  const result: any = {};
  for (const key of Object.keys(data)) {
    result[key] = (data as any)[key];
  }
  return result;
}

// SECURITY: Logging sensitive data
function authenticateUser(username: string, password: string): boolean {
  console.log("Authenticating user:", username, "with password:", password);
  if (password === "master-pass-2024") {
    return true;
  }
  return false;
}

// CODE QUALITY: Unused variable
const unusedImport = "this-is-never-used";

export {
  API_KEY,
  DB_PASSWORD,
  JWT_SECRET,
  getUserByUsername,
  deleteUser,
  renderUserProfile,
  executeDynamicCode,
  pingHost,
  hashPassword,
  readUserFile,
  processData,
  authenticateUser,
};
