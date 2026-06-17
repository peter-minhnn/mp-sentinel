import { strict as assert } from "node:assert";
import { test } from "node:test";

import { makeStreamingExtras, VSCODE_PROGRESS_ENV } from "../src/pure/streaming.js";

test("sets the internal progress env flag", () => {
  const extras = makeStreamingExtras(() => undefined);
  assert.equal(extras.extraEnv[VSCODE_PROGRESS_ENV], "1");
});

test("forwards stderr chunks to the sink, ignores stdout (the JSON report)", () => {
  const seen: string[] = [];
  const extras = makeStreamingExtras((chunk) => seen.push(chunk));

  extras.onOutput({ stream: "stderr", chunk: "60% | 6/10 files" });
  extras.onOutput({ stream: "stdout", chunk: '{"status":"PASS"}' });
  extras.onOutput({ stream: "stderr", chunk: "done" });

  assert.deepEqual(seen, ["60% | 6/10 files", "done"]);
});
