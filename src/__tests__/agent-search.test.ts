import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import { parseCliArgs } from "../cli/args.js";
import { runIndexingCommand, buildSourceIndex } from "../commands/indexing.js";
import {
  queryFiles,
  queryFilesLimited,
  queryUnifiedSearch,
  clampSearchLimit,
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
} from "../services/source-index/agent-search.js";
import {
  resolvePrettyJson,
  stringifyIndexJson,
  stringifyCompactJson,
  setIndexJsonPretty,
} from "../services/source-index/json-output.js";
import { parseLimitFlag, parseSearchKinds } from "../commands/indexing-search.js";
import { UserError } from "../utils/errors.js";
import { clearConfigCache } from "../utils/config.js";
import { clearParserCache } from "../services/source-index/parser.js";
import type { SourceIndex } from "../types/index.js";

const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "mp-sentinel-agent-search-"));
  tempDirs.push(dir);
  return dir;
};

beforeEach(() => {
  clearParserCache();
  process.argv = ["node", "mp-sentinel"];
});

afterEach(async () => {
  clearConfigCache();
  clearParserCache();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const emptyIndex = (): SourceIndex => ({
  schemaVersion: "1.5",
  generatedAt: new Date().toISOString(),
  toolVersion: "1.0.0",
  project: {
    packageName: "test",
    ecosystem: "node",
    dependencies: {},
    devDependencies: {},
    detectedFrameworks: [],
  },
  files: [],
  stats: { totalFiles: 0, indexedFiles: 0, skippedFiles: 0, parseErrors: 0 },
});

const makeProject = async (cwd: string): Promise<void> => {
  await mkdir(join(cwd, "src"), { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ name: "agent-search-test", version: "1.0.0" }),
  );
  await writeFile(
    join(cwd, "src", "index.ts"),
    `export function hello() { return "hi"; }\n` +
      `export class HelloWorld {}\n` +
      `import { z } from "zod";\n` +
      `export const parsed = z.string();\n`,
  );
  await writeFile(join(cwd, "src", "utils.ts"), `export function helper() { return true; }\n`);
};

describe("clampSearchLimit / parse flags", () => {
  it("clamps to max and falls back on invalid values", () => {
    expect(clampSearchLimit(undefined, 10)).toBe(10);
    expect(clampSearchLimit(3, 10)).toBe(3);
    expect(clampSearchLimit(999, 10)).toBe(MAX_SEARCH_LIMIT);
    expect(clampSearchLimit(0, 10)).toBe(10);
    expect(clampSearchLimit(Number.POSITIVE_INFINITY, 10)).toBe(MAX_SEARCH_LIMIT);
  });

  it("parseLimitFlag rejects non-integers", () => {
    expect(parseLimitFlag(undefined, DEFAULT_SEARCH_LIMIT)).toBe(DEFAULT_SEARCH_LIMIT);
    expect(parseLimitFlag("5", 10)).toBe(5);
    expect(() => parseLimitFlag("nope", 10)).toThrow(UserError);
    expect(() => parseLimitFlag("1.5", 10)).toThrow(UserError);
    expect(() => parseLimitFlag("5garbage", 10)).toThrow(UserError);
    expect(() => parseLimitFlag("+3", 10)).toThrow(UserError);
    expect(() => parseLimitFlag("0", 10)).toThrow(UserError);
  });

  it("parseLimitFlag clamps oversized digit strings to MAX instead of overflowing", () => {
    expect(parseLimitFlag("51", 10)).toBe(MAX_SEARCH_LIMIT);
    expect(parseLimitFlag("9".repeat(80), 10)).toBe(MAX_SEARCH_LIMIT);
  });

  it("parseSearchKinds validates the allow-list", () => {
    expect(parseSearchKinds(undefined)).toBeUndefined();
    expect(parseSearchKinds("symbol,file")).toEqual(["symbol", "file"]);
    expect(() => parseSearchKinds("symbol,nope")).toThrow(UserError);
  });
});

describe("stringifyIndexJson", () => {
  it("emits compact JSON by default", () => {
    setIndexJsonPretty(false);
    const text = stringifyIndexJson({ a: 1, b: [2] });
    expect(text).toBe('{"a":1,"b":[2]}');
    expect(text).not.toContain("\n");
  });

  it("pretty-prints when requested", () => {
    const text = stringifyIndexJson({ a: 1 }, true);
    expect(text).toContain("\n");
    expect(JSON.parse(text)).toEqual({ a: 1 });
  });

  it("resolvePrettyJson: compact wins, else pretty, else TTY", () => {
    expect(resolvePrettyJson({ compact: true, pretty: true })).toBe(false);
    expect(resolvePrettyJson({ pretty: true })).toBe(true);
    expect(resolvePrettyJson({})).toBe(Boolean(process.stdout.isTTY));
  });

  it("stringifyCompactJson ignores CLI pretty global state", () => {
    setIndexJsonPretty(true);
    try {
      const text = stringifyCompactJson({ a: 1 });
      expect(text).toBe('{"a":1}');
      expect(stringifyIndexJson({ a: 1 })).toContain("\n");
    } finally {
      setIndexJsonPretty(false);
    }
  });
});

describe("queryFiles", () => {
  it("returns empty for null/empty index", () => {
    expect(queryFiles(null, "foo")).toEqual([]);
    expect(queryFiles(emptyIndex(), "foo")).toEqual([]);
  });

  it("scores exact path highest, then basename", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);
    const index = await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );
    expect(index).not.toBeNull();

    const byPath = queryFiles(index, "src/utils.ts");
    expect(byPath[0]?.file).toBe("src/utils.ts");
    expect(byPath[0]?.score).toBe(100);

    const byBase = queryFiles(index, "utils.ts");
    expect(byBase[0]?.file).toBe("src/utils.ts");
    expect(byBase[0]?.score).toBe(95);

    const byStem = queryFiles(index, "utils");
    expect(byStem.some((r) => r.file === "src/utils.ts")).toBe(true);
  });

  it("normalizes Windows path separators to match indexed paths", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);
    const index = await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );
    expect(index).not.toBeNull();

    const byWinPath = queryFiles(index, "src\\utils.ts");
    expect(byWinPath[0]?.file).toBe("src/utils.ts");
    expect(byWinPath[0]?.score).toBe(100);
  });
});

describe("queryUnifiedSearch", () => {
  it("returns compact symbol and file hits without code by default", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);
    const index = await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );
    expect(index).not.toBeNull();

    const result = await queryUnifiedSearch(index, "hello");
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits.some((h) => h.kind === "symbol" && h.name === "hello")).toBe(true);
    expect(result.hits.every((h) => h.kind !== "code")).toBe(true);
    expect(result.hits[0]).not.toHaveProperty("reason");
    expect(result.hits[0]).not.toHaveProperty("language");
  });

  it("includes import hits for package names", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);
    const index = await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );
    expect(index).not.toBeNull();

    const result = await queryUnifiedSearch(index, "zod");
    expect(result.hits.some((h) => h.kind === "import" && h.name === "zod")).toBe(true);
  });

  it("respects --kind and --limit", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);
    const index = await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );
    expect(index).not.toBeNull();

    const filesOnly = await queryUnifiedSearch(index, "src", { kinds: ["file"], limit: 1 });
    expect(filesOnly.hits).toHaveLength(1);
    expect(filesOnly.hits[0]?.kind).toBe("file");
    expect(filesOnly.truncated).toBe(true);
  });

  it("does not mark truncated when hits exactly equal the limit", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);
    const index = await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );
    expect(index).not.toBeNull();

    const exact = await queryUnifiedSearch(index, "utils.ts", { kinds: ["file"], limit: 1 });
    expect(exact.hits).toHaveLength(1);
    expect(exact.truncated).toBe(false);

    const files = queryFilesLimited(index, "utils.ts", 1);
    expect(files.results).toHaveLength(1);
    expect(files.truncated).toBe(false);
  });
});

describe("indexing --search / --find-file CLI", () => {
  it("parses new flags", () => {
    process.argv = [
      "node",
      "mp-sentinel",
      "indexing",
      "--search",
      "hello",
      "--limit",
      "5",
      "--kind",
      "symbol,file",
      "--compact",
      "--index-format",
      "json",
    ];
    const parsed = parseCliArgs();
    expect(parsed.values.search).toBe("hello");
    expect(parsed.values.limit).toBe("5");
    expect(parsed.values.kind).toBe("symbol,file");
    expect(parsed.values.compact).toBe(true);
  });

  it("emits compact JSON hits for --search", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      await runIndexingCommand({ search: "hello", "index-format": "json", compact: true }, cwd);
      const raw = logs.join("\n");
      expect(raw).not.toContain("\n  ");
      const parsed = JSON.parse(raw) as {
        query: string;
        hits: Array<{ kind: string; name?: string }>;
      };
      expect(parsed.query).toBe("hello");
      expect(parsed.hits.some((h) => h.kind === "symbol" && h.name === "hello")).toBe(true);
    } finally {
      console.log = origLog;
    }
  });

  it("find-file returns matching indexed paths", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      await runIndexingCommand(
        { findFile: "utils.ts", "index-format": "json", compact: true },
        cwd,
      );
      const parsed = JSON.parse(logs.join("\n")) as {
        results: Array<{ file: string; score: number }>;
      };
      expect(parsed.results[0]?.file).toBe("src/utils.ts");
      expect(parsed.results[0]?.score).toBe(95);
    } finally {
      console.log = origLog;
    }
  });

  it("rejects empty --search", async () => {
    const cwd = await makeTempDir();
    await expect(
      runIndexingCommand({ search: "   ", "index-format": "json" }, cwd),
    ).rejects.toThrow("--search query must not be empty");
  });

  it("--limit caps --search hits", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      await runIndexingCommand(
        { search: "hello", "index-format": "json", limit: "1", compact: true },
        cwd,
      );
      const parsed = JSON.parse(logs.join("\n")) as { hits: unknown[]; truncated: boolean };
      expect(parsed.hits).toHaveLength(1);
      expect(parsed.truncated).toBe(true);
    } finally {
      console.log = origLog;
    }
  });
});
