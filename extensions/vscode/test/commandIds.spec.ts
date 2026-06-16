import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { ALL_COMMAND_IDS } from "../src/pure/commandIds.js";

interface Manifest {
  contributes?: { commands?: { command: string }[] };
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
