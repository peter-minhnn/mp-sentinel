import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  looksLikeUnsupportedLocalJson,
  OLD_CLI_BRANCH_REVIEW_HINT,
} from "../src/pure/cliCompat.js";

test("detects the old-CLI 'not supported in local mode' marker", () => {
  assert.ok(
    looksLikeUnsupportedLocalJson(
      "--format json is not supported in local mode — rendering console",
    ),
  );
  assert.ok(looksLikeUnsupportedLocalJson("Not Supported In Local Mode"));
});

test("does not match unrelated output", () => {
  assert.ok(!looksLikeUnsupportedLocalJson(""));
  assert.ok(!looksLikeUnsupportedLocalJson('{"status":"PASS"}'));
});

test("the upgrade hint names the fixed version and the workaround", () => {
  assert.ok(OLD_CLI_BRANCH_REVIEW_HINT.includes("3.2.5"));
  assert.ok(OLD_CLI_BRANCH_REVIEW_HINT.includes("mpSentinel.cli.command"));
});
