/**
 * Logger color behavior tests.
 *
 * The logger styles output through the shared terminal UI theme, so ANSI
 * escapes must appear by default and disappear entirely when NO_COLOR is
 * set — across stdout, stderr, and progress output. Quiet mode behavior
 * is unchanged.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { log, setLogQuietMode } from "../utils/logger.js";

const ESC = "\x1b[";

describe("logger color behavior", () => {
  const originalNoColor = process.env["NO_COLOR"];
  let logSpy: ReturnType<typeof jest.spyOn>;
  let warnSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    setLogQuietMode(false);
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    stdoutSpy = jest.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    stdoutSpy.mockRestore();
    setLogQuietMode(false);
    if (originalNoColor === undefined) {
      delete process.env["NO_COLOR"];
    } else {
      process.env["NO_COLOR"] = originalNoColor;
    }
  });

  const emitAll = (): void => {
    log.info("info line");
    log.success("success line");
    log.audit("audit line");
    log.skip("skip line");
    log.file("file line");
    log.debug("debug line");
    log.issue("CRITICAL", 1, "issue line");
    log.divider();
    log.header("header line");
    log.warning("warning line");
    log.error("error line");
    log.critical("critical line");
    log.progress(1, 2, "progress label");
  };

  const joined = (spy: ReturnType<typeof jest.spyOn>): string =>
    (spy.mock.calls as unknown[][]).map((c) => c.join(" ")).join("\n");

  it("emits ANSI escapes on stdout, stderr, and progress by default", () => {
    delete process.env["NO_COLOR"];
    emitAll();

    expect(joined(logSpy)).toContain(ESC);
    expect(joined(warnSpy)).toContain(ESC);
    expect(joined(errorSpy)).toContain(ESC);
    expect(joined(stdoutSpy)).toContain(ESC);
  });

  it("emits no ANSI escapes anywhere when NO_COLOR is set", () => {
    process.env["NO_COLOR"] = "1";
    emitAll();

    expect(joined(logSpy)).not.toContain(ESC);
    expect(joined(warnSpy)).not.toContain(ESC);
    expect(joined(errorSpy)).not.toContain(ESC);
    expect(joined(stdoutSpy)).not.toContain(ESC);

    // Content is still present, just unstyled
    expect(joined(logSpy)).toContain("info line");
    expect(joined(logSpy)).toContain("[CRITICAL] Line 1: issue line");
    expect(joined(errorSpy)).toContain("critical line");
    expect(joined(stdoutSpy)).toContain("progress label");
  });

  it("quiet mode still suppresses all output regardless of NO_COLOR", () => {
    process.env["NO_COLOR"] = "1";
    setLogQuietMode(true);
    emitAll();

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});
