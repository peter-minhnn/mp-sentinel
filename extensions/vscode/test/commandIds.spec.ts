import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { ALL_COMMAND_IDS } from "../src/pure/commandIds.js";
import { PANEL_CONTAINER_ID, PANEL_VIEW_ID } from "../src/pure/panelView.js";

interface Manifest {
  contributes?: {
    commands?: { command: string }[];
    views?: Record<string, { id: string; type?: string }[]>;
    viewsContainers?: { activitybar?: { id: string }[] };
    configuration?: { properties?: Record<string, unknown> };
  };
}

function loadManifest(): Manifest {
  // Compiled spec lives at dist-test/test/; package.json is two levels up.
  const manifestPath = path.join(__dirname, "..", "..", "package.json");
  return JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
}

test("every contributed command is backed by a registered command id", () => {
  const contributed = (loadManifest().contributes?.commands ?? []).map((c) => c.command).sort();
  assert.deepEqual(contributed, [...ALL_COMMAND_IDS]);
});

test("command ids are unique and namespaced under mpSentinel.", () => {
  const unique = new Set(ALL_COMMAND_IDS);
  assert.equal(unique.size, ALL_COMMAND_IDS.length);
  for (const id of ALL_COMMAND_IDS) {
    assert.ok(id.startsWith("mpSentinel."), `expected ${id} to be namespaced`);
  }
});

test("the branch-diff command is contributed and in the allow-list", () => {
  const contributed = (loadManifest().contributes?.commands ?? []).map((c) => c.command);
  assert.ok(contributed.includes("mpSentinel.reviewBranchDiff"));
  assert.ok((ALL_COMMAND_IDS as readonly string[]).includes("mpSentinel.reviewBranchDiff"));
});

test("the manifest contributes the new AI provider settings", () => {
  const props = loadManifest().contributes?.configuration?.properties ?? {};
  for (const key of [
    "mpSentinel.ai.anthropicBaseUrl",
    "mpSentinel.ai.openrouterSiteUrl",
    "mpSentinel.ai.openrouterAppName",
  ]) {
    assert.ok(key in props, `expected setting ${key} in manifest`);
  }
});

test("the contributed webview view id matches the provider constant", () => {
  const manifest = loadManifest();
  const views = manifest.contributes?.views?.[PANEL_CONTAINER_ID] ?? [];
  const panel = views.find((v) => v.id === PANEL_VIEW_ID);
  assert.ok(
    panel,
    `expected a view with id ${PANEL_VIEW_ID} under container ${PANEL_CONTAINER_ID}`,
  );
  assert.equal(panel?.type, "webview");
});

test("the activity-bar container id matches the view container constant", () => {
  const containers = loadManifest().contributes?.viewsContainers?.activitybar ?? [];
  assert.ok(
    containers.some((c) => c.id === PANEL_CONTAINER_ID),
    `expected an activity-bar container with id ${PANEL_CONTAINER_ID}`,
  );
});
