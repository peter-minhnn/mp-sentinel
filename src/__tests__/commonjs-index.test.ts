import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { parseFile as parseActual, clearParserCache } from "../services/source-index/parser.js";
import { buildSourceIndex } from "../commands/indexing.js";
import { setLogQuietMode } from "../utils/logger.js";
import { CURRENT_EXTRACTOR_VERSION } from "../services/source-index/extraction-version.js";
import type { IndexableLanguage } from "../types/index.js";

const dirs: string[] = [];
beforeEach(() => clearParserCache());
const parseFile = async (path: string, content: string) => {
  const result = await parseActual(path, content, "javascript");
  if (!result) throw new Error("expected JavaScript parse result");
  return result;
};
afterEach(async () => {
  clearParserCache();
  setLogQuietMode(false);
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("CommonJS AST extraction", () => {
  it("attributes separate same-line exported functions by source span, not line alone", async () => {
    const file = await parseFile(
      "one-line.js",
      `exports.first = function() { one(); }; exports.second = function() { two(); };`,
    );
    expect(file.calls?.find((call) => call.callee === "one")?.inSymbol).toBe("first");
    expect(file.calls?.find((call) => call.callee === "two")?.inSymbol).toBe("second");
  });
  it("does not invent export names from unsupported escaped or computed property keys", async () => {
    const file = await parseFile(
      "keys.js",
      String.raw`module.exports = { "plain-name": () => 1, "escaped\u0061": () => 2, [dynamicName]: () => 3 };`,
    );
    expect(file.exports.flatMap((item) => item.names)).toEqual(["plain-name"]);
    expect(file.symbols.map((item) => item.name)).toContain("plain-name");
    expect(file.symbols.map((item) => item.name)).not.toContain('"escaped\\u0061"');
  });
  it("resolves locally bound anonymous callables exported by identifier or shorthand", async () => {
    const file = await parseFile(
      "bindings.js",
      `
      const run = async () => work();
      const stop = function() { halt(); };
      module.exports = { run, finish: stop };
      exports.api = run;
    `,
    );
    expect(file.symbols.filter((item) => item.name === "run")).toHaveLength(1);
    expect(file.symbols.filter((item) => item.name === "stop")).toHaveLength(1);
    expect(file.exports.flatMap((item) => item.names)).toEqual(["run", "finish", "api"]);
  });

  it("distinguishes destructuring keys from actual local bindings", async () => {
    const file = await parseFile(
      "destructured.js",
      `
      function shadow({ load: require }, module) { require('./fake'); module.exports = () => 0; }
      function native({ require: custom }) { require('./real'); }
      const module = {};
      module.exports = () => 1;
      obj.exports = () => 2;
    `,
    );
    expect(file.imports.map((item) => item.source)).toEqual(["./real"]);
    expect(file.exports).toHaveLength(0);
  });
  it("captures static imports with namespace, destructuring, member and side-effect bindings", async () => {
    const file = await parseFile(
      "sample.js",
      `
      const dep = require('./dep');
      const { run: localRun, extra } = require('@pkg/core');
      const start = require('./boot').start;
      require('./setup');
      const ignored = require(dynamicName);
      obj.require('./not-an-import');
      const text = "require('./text')";
      // require('./comment')
    `,
    );
    expect(file.imports.map(({ source, names }) => ({ source, names }))).toEqual([
      { source: "./dep", names: ["dep"] },
      { source: "@pkg/core", names: ["run", "extra"] },
      { source: "./boot", names: ["start"] },
      { source: "./setup", names: [] },
    ]);
    expect(file.imports[0]?.line).toBe(2);
  });

  it("ignores shadowed globals and hoisted bindings without hiding valid sibling imports", async () => {
    const file = await parseFile(
      "scope.js",
      `
      function local(require, module, exports) {
        require('./fake'); module.exports = () => 1; exports.fake = () => 2;
      }
      function hoisted() { require('./also-fake'); var require; }
      { const require = fake; require('./block-fake'); }
      try {} catch (require) { require('./catch-fake'); }
      const dep = require('./real');
      exports.run = () => dep();
    `,
    );
    expect(file.imports.map((item) => item.source)).toEqual(["./real"]);
    expect(file.exports.flatMap((item) => item.names)).toEqual(["run"]);
  });

  it("indexes anonymous default functions and assigns otherwise unattributed calls", async () => {
    const file = await parseFile(
      "service.js",
      `module.exports = async function(input) { return processInput(input); };`,
    );
    expect(file.exports).toEqual([
      expect.objectContaining({ kind: "default", names: ["default"], isDefault: true }),
    ]);
    expect(file.symbols).toContainEqual(
      expect.objectContaining({ name: "default", type: "function", line: 1 }),
    );
    expect(file.calls).toContainEqual(
      expect.objectContaining({ callee: "processInput", inSymbol: "default" }),
    );
  });

  it("indexes exported object methods, arrow pairs and named member assignments without duplicate methods", async () => {
    const file = await parseFile(
      "object.js",
      `
      module.exports = { async run() { return work(); }, stop: () => halt(), value: 1 };
      exports.extra = function() { return more(); };
      module.exports['named'] = () => done();
      module.exports[unknown] = () => ignored();
    `,
    );
    expect(file.exports.flatMap((item) => item.names)).toEqual([
      "run",
      "stop",
      "value",
      "extra",
      "named",
    ]);
    expect(file.symbols.filter((item) => item.name === "run")).toHaveLength(1);
    for (const name of ["run", "stop", "extra", "named"]) {
      expect(file.symbols.some((item) => item.name === name)).toBe(true);
    }
  });

  it("keeps ESM extraction and static CommonJS forwarding in mixed modules", async () => {
    const file = await parseFile(
      "mixed.js",
      `import x from './esm.js'; export function run() {} module.exports = require('./forward');`,
    );
    expect(file.imports.map((item) => item.source)).toEqual(["./esm.js", "./forward"]);
    expect(file.exports).toContainEqual(
      expect.objectContaining({ source: "./forward", isDefault: true }),
    );
    expect(file.symbols.some((item) => item.name === "run")).toBe(true);
  });
});

describe("CommonJS graph and cache upgrade", () => {
  const config = {
    enabled: true,
    languages: ["typescript", "javascript"] as IndexableLanguage[],
    cachePath: ".mp-sentinel-cache/source-index.json",
    maxFileSize: 512000,
  };
  it("resolves relative, directory and alias imports, external packages, cycles and missing targets", async () => {
    const root = await mkdtemp(join(tmpdir(), "sentinel-commonjs-"));
    dirs.push(root);
    await mkdir(join(root, "src/lib"), { recursive: true });
    await mkdir(join(root, "src/utils"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "commonjs-fixture" }));
    await writeFile(
      join(root, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@utils/*": ["src/utils/*"] } } }),
    );
    await writeFile(
      join(root, "src/a.js"),
      `const b=require('./b'); require('./lib'); require('@utils/help'); require('node:fs'); require('./missing'); module.exports = () => b();`,
    );
    await writeFile(
      join(root, "src/b.js"),
      `require('./a'); module.exports = function() { return 2; };`,
    );
    await writeFile(join(root, "src/lib/index.js"), `module.exports = { value: 1 };`);
    await writeFile(join(root, "src/utils/help.js"), `exports.help = () => 3;`);
    setLogQuietMode(true);
    const first = await buildSourceIndex(root, config, true);
    const a = first?.files.find((file) => file.path === "src/a.js");
    expect(a?.importsFrom).toEqual(
      expect.arrayContaining(["src/b.js", "src/lib/index.js", "src/utils/help.js"]),
    );
    expect(a?.importsFrom).not.toContain("node:fs");
    expect(a?.importsFrom).not.toContain("./missing");
    expect(first?.files.find((file) => file.path === "src/b.js")?.importsFrom).toContain(
      "src/a.js",
    );
    expect(first?.extractorVersion).toBe(CURRENT_EXTRACTOR_VERSION);
    const path = join(root, config.cachePath);
    const cached = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    delete cached.extractorVersion;
    await writeFile(path, JSON.stringify(cached));
    const upgraded = await buildSourceIndex(root, config, false);
    expect(upgraded?.extractorVersion).toBe(CURRENT_EXTRACTOR_VERSION);
    expect(upgraded?.stats.parsedFiles).toBe(4);
    const reused = await buildSourceIndex(root, config, false);
    expect(reused?.stats.parsedFiles).toBe(upgraded?.stats.parsedFiles);
  });
});
