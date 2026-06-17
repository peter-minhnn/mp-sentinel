/**
 * Tests for the internal VS Code progress channel. In quiet (machine-format)
 * mode, logs are dropped by default but routed to stderr when
 * MP_SENTINEL_VSCODE_PROGRESS=1 — stdout (reserved for JSON) is never touched.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { log, setLogQuietMode } from "../utils/logger.js";

describe("logger progress channel", () => {
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errSpy: ReturnType<typeof jest.spyOn>;
  const original = process.env["MP_SENTINEL_VSCODE_PROGRESS"];

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    errSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    setLogQuietMode(false);
    if (original === undefined) delete process.env["MP_SENTINEL_VSCODE_PROGRESS"];
    else process.env["MP_SENTINEL_VSCODE_PROGRESS"] = original;
  });

  it("stays fully silent in quiet mode without the progress env", () => {
    setLogQuietMode(true);
    delete process.env["MP_SENTINEL_VSCODE_PROGRESS"];
    log.info("hello");
    log.progress(6, 10, "files");
    expect(logSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("routes quiet logs/progress to stderr (never stdout) when the env is set", () => {
    setLogQuietMode(true);
    process.env["MP_SENTINEL_VSCODE_PROGRESS"] = "1";
    log.info("scanning");
    log.progress(6, 10, "files audited");
    expect(logSpy).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
    const out = errSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(out).toContain("scanning");
    expect(out).toContain("60% | 6/10 files audited");
  });

  it("logs to stdout as before in non-quiet mode", () => {
    setLogQuietMode(false);
    log.info("normal");
    expect(logSpy).toHaveBeenCalled();
  });
});
