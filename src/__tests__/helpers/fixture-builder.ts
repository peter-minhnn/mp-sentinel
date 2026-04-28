/**
 * Fixture builder for review intelligence tests — creates real mini-projects
 * for each profile and builds source indexes via the real pipeline.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildSourceIndex } from "../../commands/indexing.js";
import type { SkillProfile, SourceIndex, IndexingConfig } from "../../types/index.js";

export interface FixtureResult {
  cwd: string;
  index: SourceIndex;
  profile: SkillProfile;
}

export interface IndexedFixture {
  cwd: string;
  index: SourceIndex;
  profile: SkillProfile;
}

const INDEXING_CONFIG: IndexingConfig = {
  enabled: true,
  languages: ["typescript", "tsx", "javascript", "jsx"],
  cachePath: ".mp-sentinel-cache/source-index.json",
  maxFileSize: 512000,
  maxRelatedFiles: 3,
};

async function writeFiles(cwd: string, files: Record<string, string>): Promise<void> {
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(cwd, relPath);
    await mkdir(join(fullPath, ".."), { recursive: true });
    await writeFile(fullPath, content);
  }
}

async function indexProject(cwd: string): Promise<SourceIndex> {
  const idx = await buildSourceIndex(cwd, INDEXING_CONFIG, true);
  if (!idx) throw new Error(`Failed to build source index for fixture at ${cwd}`);
  return idx;
}

/**
 * Create a CLI-tooling fixture with:
 * - package.json with bin field
 * - CLI entry, config (hub), re-export, untested command
 * - commander dependency
 */
export async function createCliToolingFixture(cwd: string): Promise<IndexedFixture> {
  await writeFiles(cwd, {
    "package.json": JSON.stringify({
      name: "cli-fixture",
      version: "1.0.0",
      bin: { "cli-fixture": "./dist/index.js" },
      scripts: { build: "tsc", test: "jest" },
      dependencies: { commander: "12.0.0" },
    }),
    "src/index.ts": `
      import { Command } from "commander";
      import { config } from "./config.js";
      export function main() { return config; }
    `,
    "src/config.ts": `
      export const config = { verbose: true };
      export function loadConfig() { return config; }
    `,
    "src/commands/build.ts": `
      import { config } from "../config.js";
      export function build() { return config; }
    `,
    "src/commands/info.ts": `
      import { config } from "../config.js";
      export function info() { return config; }
    `,
    "src/commands/scan.ts": `
      import { config } from "../config.js";
      export function scan() { return config; }
    `,
    "src/lib.ts": `
      export { config } from "./config.js";
      export { build } from "./commands/build.js";
    `,
    "src/commands/build.test.ts": `
      import { build } from "./build.js";
      test('build', () => { expect(build()).toBeDefined(); });
    `,
    "src/config.test.ts": `
      import { config } from "./config.js";
      test('config', () => { expect(config).toBeDefined(); });
    `,
  });

  const index = await indexProject(cwd);
  return { cwd, index, profile: "cli-tooling" };
}

/**
 * Create a Library fixture with:
 * - Public API surface via re-exports
 * - Hub file (imported by multiple)
 * - Tested & untested files
 * - External dependency usage (lodash)
 */
export async function createLibraryFixture(cwd: string): Promise<IndexedFixture> {
  await writeFiles(cwd, {
    "package.json": JSON.stringify({
      name: "lib-fixture",
      version: "2.0.0",
      scripts: { build: "tsc", test: "jest" },
      dependencies: { lodash: "4.17.21" },
    }),
    "src/index.ts": `
      export { api } from "./api.js";
      export { helpers } from "./helpers.js";
    `,
    "src/api.ts": `
      import _ from "lodash";
      import { helpers } from "./helpers.js";
      export function api() { return helpers(); }
      export function publicFn() { return 1; }
    `,
    "src/helpers.ts": `
      export function helpers() { return "helper"; }
    `,
    "src/consumer1.ts": `
      import { helpers } from "./helpers.js";
      export const c1 = helpers();
    `,
    "src/consumer2.ts": `
      import { helpers } from "./helpers.js";
      export const c2 = helpers();
    `,
    "src/consumer3.ts": `
      import { helpers } from "./helpers.js";
      export const c3 = helpers();
    `,
    "src/unused.ts": `
      export function unused() { return "no one imports me"; }
    `,
    "src/api.test.ts": `
      import { api } from "./api.js";
      test('api', () => { expect(api()).toBeDefined(); });
    `,
    "src/helpers.test.ts": `
      import { helpers } from "./helpers.js";
      test('helpers', () => { expect(helpers()).toBe("helper"); });
    `,
  });

  const index = await indexProject(cwd);
  return { cwd, index, profile: "library" };
}

/**
 * Create a Node-service fixture with:
 * - express dependency
 * - Server entry, routes hub, middleware
 * - Tested and untested files
 */
export async function createNodeServiceFixture(cwd: string): Promise<IndexedFixture> {
  await writeFiles(cwd, {
    "package.json": JSON.stringify({
      name: "svc-fixture",
      version: "1.0.0",
      scripts: { start: "node dist/server.js", test: "jest" },
      dependencies: { express: "4.18.2" },
    }),
    "src/server.ts": `
      import express from "express";
      import { routes } from "./routes.js";
      export function createServer() {
        const app = express();
        app.use(routes());
        return app;
      }
    `,
    "src/routes.ts": `
      import { middleware } from "./middleware.js";
      export function routes() { return middleware(); }
    `,
    "src/middleware.ts": `
      export function middleware() { return (req: any, res: any, next: any) => next(); }
    `,
    "src/handler1.ts": `
      import { middleware } from "./middleware.js";
      export function h1() { return middleware(); }
    `,
    "src/handler2.ts": `
      import { middleware } from "./middleware.js";
      export function h2() { return middleware(); }
    `,
    "src/handler3.ts": `
      import { middleware } from "./middleware.js";
      export function h3() { return middleware(); }
    `,
    "src/lib.ts": `
      export { createServer } from "./server.js";
      export { middleware } from "./middleware.js";
    `,
    "src/routes.test.ts": `
      import { routes } from "./routes.js";
      test('routes', () => { expect(routes()).toBeDefined(); });
    `,
    "src/server.test.ts": `
      import { createServer } from "./server.js";
      test('server', () => { expect(createServer()).toBeDefined(); });
    `,
  });

  const index = await indexProject(cwd);
  return { cwd, index, profile: "node-service" };
}

/**
 * Create a React-Next fixture with:
 * - react dependency
 * - App component, Header hub, Footer untested
 * - Component tests
 */
export async function createReactNextFixture(cwd: string): Promise<IndexedFixture> {
  await writeFiles(cwd, {
    "package.json": JSON.stringify({
      name: "ui-fixture",
      version: "1.0.0",
      scripts: { dev: "next dev", build: "next build", test: "jest" },
      dependencies: { react: "18.3.1", "react-dom": "18.3.1" },
      devDependencies: { next: "14.0.0" },
    }),
    "src/App.tsx": `
      import React from "react";
      import { Header } from "./Header.js";
      export function App() { return <Header />; }
    `,
    "src/Header.tsx": `
      import React from "react";
      export function Header() { return <header>Header</header>; }
    `,
    "src/Footer.tsx": `
      import React from "react";
      export function Footer() { return <footer>Footer</footer>; }
    `,
    "src/Sidebar.tsx": `
      import React from "react";
      import { Header } from "./Header.js";
      export function Sidebar() { return <Header />; }
    `,
    "src/Layout.tsx": `
      import React from "react";
      import { Header } from "./Header.js";
      export function Layout() { return <Header />; }
    `,
    "src/Nav.tsx": `
      import React from "react";
      import { Header } from "./Header.js";
      export function Nav() { return <Header />; }
    `,
    "src/index.ts": `
      export { App } from "./App.js";
      export { Header } from "./Header.js";
    `,
    "src/Header.test.tsx": `
      import { Header } from "./Header.js";
      test('Header', () => { expect(Header()).toBeDefined(); });
    `,
    "src/App.test.tsx": `
      import { App } from "./App.js";
      test('App', () => { expect(App()).toBeDefined(); });
    `,
  });

  const index = await indexProject(cwd);
  return { cwd, index, profile: "react-next" };
}

/**
 * Get the fixture builder for a given profile
 */
export async function createFixture(cwd: string, profile: SkillProfile): Promise<IndexedFixture> {
  switch (profile) {
    case "cli-tooling":
      return createCliToolingFixture(cwd);
    case "library":
      return createLibraryFixture(cwd);
    case "node-service":
      return createNodeServiceFixture(cwd);
    case "react-next":
      return createReactNextFixture(cwd);
    default:
      throw new Error(`Unknown profile: ${profile}`);
  }
}
