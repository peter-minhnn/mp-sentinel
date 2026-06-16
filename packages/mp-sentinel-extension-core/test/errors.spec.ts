import { strict as assert } from "node:assert";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import {
  CliExecError,
  CliRuntimeError,
  isAborted,
  userMessageForFailure,
  type CliFailureKind,
} from "../src/errors.js";
import { CliRunner, type SpawnFn } from "../src/runner.js";
import { MpSentinelService } from "../src/service.js";

/** Minimal fake ChildProcess driven programmatically by the test. */
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  kill(_signal?: NodeJS.Signals): boolean {
    this.killed = true;
    return true;
  }
  emitRun(stdout: string, stderr: string, code: number): void {
    setImmediate(() => {
      if (stdout) this.stdout.emit("data", Buffer.from(stdout));
      if (stderr) this.stderr.emit("data", Buffer.from(stderr));
      this.emit("close", code, null);
    });
  }
}

function spawnReturning(child: FakeChild): SpawnFn {
  return () => child as unknown as ChildProcess;
}

test("runner: timeout rejects with a typed timeout failure", async () => {
  const child = new FakeChild(); // never emits close
  const runner = new CliRunner({ command: "mp-sentinel", spawnFn: spawnReturning(child) });
  await assert.rejects(
    () => runner.run({ args: ["--staged"], cwd: "/repo", env: {}, timeoutMs: 5 }),
    (error: unknown) => {
      assert.ok(error instanceof CliExecError);
      assert.equal(error.kind, "timeout");
      return true;
    },
  );
  assert.equal(child.killed, true);
});

test("runner: an already-aborted signal rejects with kind 'aborted'", async () => {
  const child = new FakeChild();
  const runner = new CliRunner({ command: "mp-sentinel", spawnFn: spawnReturning(child) });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => runner.run({ args: ["--staged"], cwd: "/repo", env: {}, signal: controller.signal }),
    (error: unknown) => {
      assert.ok(error instanceof CliExecError);
      assert.equal(error.kind, "aborted");
      assert.ok(isAborted(error));
      return true;
    },
  );
});

test("runner: a spawn error rejects with kind 'spawn' and redacts secrets", async () => {
  const child = new FakeChild();
  const runner = new CliRunner({ command: "mp-sentinel", spawnFn: spawnReturning(child) });
  setImmediate(() =>
    child.emit("error", new Error("spawn failed near ANTHROPIC_API_KEY=sk-secret-value")),
  );
  await assert.rejects(
    () =>
      runner.run({
        args: ["--staged"],
        cwd: "/repo",
        env: {},
        secrets: { ANTHROPIC_API_KEY: "sk-secret-value" },
      }),
    (error: unknown) => {
      assert.ok(error instanceof CliExecError);
      assert.equal(error.kind, "spawn");
      assert.ok(!error.message.includes("sk-secret-value"));
      assert.ok(error.message.includes("***REDACTED***"));
      return true;
    },
  );
});

test("service: exit code 2 throws CliRuntimeError (kind 'runtime') with redacted stderr", async () => {
  const child = new FakeChild();
  const service = new MpSentinelService({ command: "mp-sentinel", spawnFn: spawnReturning(child) });
  child.emitRun("", "boom GITHUB_TOKEN=ghp_topsecret", 2);
  await assert.rejects(
    () => service.indexHealth({ cwd: "/repo", secrets: { GITHUB_TOKEN: "ghp_topsecret" } }),
    (error: unknown) => {
      assert.ok(error instanceof CliRuntimeError);
      assert.ok(error instanceof CliExecError);
      assert.equal(error.kind, "runtime");
      assert.equal(error.exitCode, 2);
      assert.ok(!error.stderr.includes("ghp_topsecret"));
      assert.ok(error.stderr.includes("***REDACTED***"));
      return true;
    },
  );
});

test("service: unparseable stdout throws a typed parse failure", async () => {
  const child = new FakeChild();
  const service = new MpSentinelService({ command: "mp-sentinel", spawnFn: spawnReturning(child) });
  child.emitRun("not json at all", "", 0);
  await assert.rejects(
    () => service.indexHealth({ cwd: "/repo" }),
    (error: unknown) => {
      assert.ok(error instanceof CliExecError);
      assert.equal(error.kind, "parse");
      return true;
    },
  );
});

test("userMessageForFailure: every kind yields a non-empty, secret-free sentence", () => {
  const kinds: CliFailureKind[] = ["spawn", "timeout", "aborted", "runtime", "parse"];
  for (const kind of kinds) {
    const message = userMessageForFailure(kind);
    assert.ok(message.length > 0);
    assert.ok(!message.includes("REDACTED"));
  }
});
