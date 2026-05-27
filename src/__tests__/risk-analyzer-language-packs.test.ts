/**
 * Tests for the per-language risk pattern packs (Phase 2.3).
 *
 * Each test uses the analyzer's public surface (analyzeDiffs) to verify
 * that the right pattern fires for the right file extension AND that
 * patterns don't leak into the wrong language.
 */

import { describe, expect, it } from "@jest/globals";
import { analyzeDiffs } from "../services/risk-analyzer/index.js";

const analyze = (filePath: string, body: string) =>
  analyzeDiffs([{ path: filePath, content: body }]);

const matchesLabel = (result: ReturnType<typeof analyzeDiffs>, label: string): boolean => {
  return result.files.some((f) =>
    (f.issues ?? []).some((i) => (i.evidence ?? "").includes(`pattern: ${label}`)),
  );
};

// ── Python ─────────────────────────────────────────────────────────────────

describe("Phase 2.3 — Python patterns", () => {
  it("flags pickle.loads on a .py file", () => {
    const r = analyze("src/x.py", "import pickle\nobj = pickle.loads(payload)\n");
    expect(r.totalCritical).toBeGreaterThanOrEqual(1);
    expect(matchesLabel(r, "pickle.loads / cPickle.loads")).toBe(true);
  });

  it("flags subprocess shell=True on a .py file", () => {
    const r = analyze("src/x.py", "import subprocess\nsubprocess.run('ls ' + user, shell=True)\n");
    expect(r.totalCritical).toBeGreaterThanOrEqual(1);
  });

  it("does NOT apply Python patterns to a .ts file", () => {
    const r = analyze("src/x.ts", "pickle.loads(payload)");
    expect(matchesLabel(r, "pickle.loads / cPickle.loads")).toBe(false);
  });
});

// ── Go ─────────────────────────────────────────────────────────────────────

describe("Phase 2.3 — Go patterns", () => {
  it("flags exec.Command with sh -c on a .go file", () => {
    const r = analyze(
      "src/cmd/main.go",
      `out, _ := exec.Command("/bin/sh", "-c", "ls " + user).Output()`,
    );
    expect(r.totalCritical).toBeGreaterThanOrEqual(1);
    expect(matchesLabel(r, "exec.Command with /bin/sh -c")).toBe(true);
  });

  it("flags http.Client{} without timeout", () => {
    const r = analyze("src/cmd/main.go", "client := &http.Client{}");
    expect(matchesLabel(r, "http.Client without timeout")).toBe(true);
  });

  it("does NOT apply Go patterns to a .py file", () => {
    const r = analyze("src/x.py", 'exec.Command("/bin/sh", "-c", "ls")');
    expect(matchesLabel(r, "exec.Command with /bin/sh -c")).toBe(false);
  });
});

// ── Rust ───────────────────────────────────────────────────────────────────

describe("Phase 2.3 — Rust patterns", () => {
  it("flags mem::transmute on .rs file", () => {
    const r = analyze("src/lib.rs", "let x = unsafe { std::mem::transmute(y) };");
    expect(r.totalCritical).toBeGreaterThanOrEqual(1);
    expect(matchesLabel(r, "mem::transmute")).toBe(true);
  });

  it("does NOT flag .unwrap() in test files", () => {
    const r = analyze("src/__tests__/foo.rs", "let x = parse(s).unwrap();");
    expect(matchesLabel(r, "Result/Option unwrap() outside tests")).toBe(false);
  });

  it("flags .unwrap() in non-test source files", () => {
    const r = analyze("src/lib.rs", "let x = parse(s).unwrap();");
    expect(matchesLabel(r, "Result/Option unwrap() outside tests")).toBe(true);
  });

  it("does NOT flag unsafe block in -sys / ffi crates", () => {
    const r = analyze("src/ffi/bindings.rs", "unsafe { extern_c_call() }");
    expect(matchesLabel(r, "unsafe block")).toBe(false);
  });
});

// ── PHP ────────────────────────────────────────────────────────────────────

describe("Phase 2.3 — PHP patterns", () => {
  it("flags unserialize on superglobal", () => {
    const r = analyze("src/x.php", "<?php $obj = unserialize($_POST['data']);");
    expect(r.totalCritical).toBeGreaterThanOrEqual(1);
    expect(matchesLabel(r, "unserialize on user input")).toBe(true);
  });

  it("flags extract() on $_REQUEST", () => {
    const r = analyze("src/x.php", "<?php extract($_REQUEST);");
    expect(matchesLabel(r, "extract() on superglobal")).toBe(true);
  });

  it("flags include with $_GET path", () => {
    const r = analyze("src/x.php", "<?php include $_GET['page'];");
    expect(matchesLabel(r, "include / require with superglobal")).toBe(true);
  });
});

// ── Ruby ───────────────────────────────────────────────────────────────────

describe("Phase 2.3 — Ruby patterns", () => {
  it("flags Marshal.load on .rb file", () => {
    const r = analyze("src/x.rb", "data = Marshal.load(payload)");
    expect(r.totalCritical).toBeGreaterThanOrEqual(1);
    expect(matchesLabel(r, "Marshal.load")).toBe(true);
  });

  it("flags shell command with interpolation", () => {
    const r = analyze("src/x.rb", 'system("ls #{params[:dir]}")');
    expect(matchesLabel(r, "Shell exec with interpolation")).toBe(true);
  });

  it("flags YAML.load (Psych) without safe_load", () => {
    const r = analyze("src/x.rb", "data = YAML.load(input)");
    expect(matchesLabel(r, "YAML.load (Psych) without safe_load")).toBe(true);
  });
});

// ── Cross-language sanity ──────────────────────────────────────────────────

describe("Phase 2.3 — universal patterns still apply to all languages", () => {
  it("flags eval() in Python via the language pack (not the universal)", () => {
    const r = analyze("src/x.py", "eval(user_input)");
    // Both packs catch eval; we just need at least one CRITICAL.
    expect(r.totalCritical).toBeGreaterThanOrEqual(1);
  });
});
