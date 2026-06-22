import { strict as assert } from "node:assert";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import { CliRunner, type SpawnFn } from "../src/runner.js";

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

function fakeRunner(
  child: FakeChild,
  capture?: (cmd: string, args: readonly string[]) => void,
): CliRunner {
  const spawnFn: SpawnFn = (cmd, args) => {
    capture?.(cmd, args);
    return child as unknown as ChildProcess;
  };
  return new CliRunner({ command: "mp-sentinel", spawnFn });
}

test("captures stdout/stderr and exit code; prepends baseArgs", async () => {
  const child = new FakeChild();
  let seen: { cmd: string; args: readonly string[] } | undefined;
  const spawnFn: SpawnFn = (cmd, args) => {
    seen = { cmd, args };
    return child as unknown as ChildProcess;
  };
  const runner = new CliRunner({ command: "npx", baseArgs: ["mp-sentinel"], spawnFn });

  child.emitRun('{"status":"PASS"}', "warn: heads up", 0);
  const result = await runner.run({
    args: ["--staged", "--format", "json"],
    cwd: "/repo",
    env: {},
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, '{"status":"PASS"}');
  assert.equal(result.stderr, "warn: heads up");
  if (process.platform === "win32") {
    assert.ok(seen?.cmd.toLowerCase().endsWith("node.exe"));
    assert.match(String(seen?.args[0]), /npx-cli\.js$/);
    assert.deepEqual(seen?.args.slice(1), ["mp-sentinel", "--staged", "--format", "json"]);
  } else {
    assert.equal(seen?.cmd, "npx");
    assert.deepEqual(seen?.args, ["mp-sentinel", "--staged", "--format", "json"]);
  }
});

test("exit code 1 (findings) is returned verbatim, not treated as failure", async () => {
  const child = new FakeChild();
  const runner = fakeRunner(child);
  child.emitRun('{"status":"FAIL"}', "", 1);
  const result = await runner.run({ args: ["--staged"], cwd: "/repo", env: {} });
  assert.equal(result.exitCode, 1);
});

test("refuses to spawn if a secret would land in argv", async () => {
  const child = new FakeChild();
  const runner = fakeRunner(child);
  await assert.rejects(
    () =>
      runner.run({
        args: ["--token", "leaked"],
        cwd: "/repo",
        env: {},
        secrets: { GITHUB_TOKEN: "leaked" },
      }),
    /secret value was found in command arguments/,
  );
});

test("aborts when the signal is already aborted", async () => {
  const child = new FakeChild();
  const runner = fakeRunner(child);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => runner.run({ args: ["--staged"], cwd: "/repo", env: {}, signal: controller.signal }),
    /aborted/,
  );
  assert.equal(child.killed, true);
});

test("streams redacted output chunks while still buffering the full result", async () => {
  const child = new FakeChild();
  const runner = fakeRunner(child);
  const events: Array<{ stream: string; chunk: string }> = [];

  child.emitRun('{"status":"PASS"}', "progress GITHUB_TOKEN=ghp_secretvalue done", 0);
  const result = await runner.run({
    args: ["--staged"],
    cwd: "/repo",
    env: {},
    secrets: { GITHUB_TOKEN: "ghp_secretvalue" },
    onOutput: (e) => events.push({ stream: e.stream, chunk: e.chunk }),
  });

  // Full buffers preserved for parse/error handling.
  assert.equal(result.stdout, '{"status":"PASS"}');
  // Live chunks fired, and the secret never reached the callback.
  const stderrChunks = events.filter((e) => e.stream === "stderr").map((e) => e.chunk);
  assert.ok(stderrChunks.length > 0);
  assert.ok(!stderrChunks.join("").includes("ghp_secretvalue"));
  assert.ok(stderrChunks.join("").includes("***REDACTED***"));
});

test("propagates spawn error events", async () => {
  const child = new FakeChild();
  const runner = fakeRunner(child);
  setImmediate(() => child.emit("error", new Error("ENOENT: mp-sentinel not found")));
  await assert.rejects(() => runner.run({ args: ["--staged"], cwd: "/repo", env: {} }), /ENOENT/);
});
