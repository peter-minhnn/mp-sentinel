import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  countBySeverity,
  groupFindingsByFile,
  INITIAL_PANEL_STATE,
  PANEL_VIEW_ID,
  renderPanelHtml,
  toPanelFindings,
  type PanelFinding,
  type PanelState,
} from "../src/pure/panelView.js";

const NONCE = "abc123NONCE";
const CSP = "vscode-resource://host";

function render(state: PanelState): string {
  return renderPanelHtml(state, { nonce: NONCE, cspSource: CSP });
}

const sampleFindings: PanelFinding[] = [
  { filePath: "src/a.ts", line: 10, severity: "CRITICAL", message: "boom" },
  { filePath: "src/a.ts", line: 20, severity: "WARNING", message: "careful" },
  { filePath: "src/b.ts", line: 5, severity: "INFO", message: "note" },
];

test("empty state renders the idle status and an empty-results hint", () => {
  const html = render(INITIAL_PANEL_STATE);
  assert.ok(html.includes("Idle"));
  assert.ok(html.includes("No findings"));
  assert.ok(html.includes('class="actions"'));
});

test("busy state renders the running label", () => {
  const html = render({ ...INITIAL_PANEL_STATE, phase: "running", busyLabel: "Reviewing staged" });
  assert.ok(html.includes("status running"));
  assert.ok(html.includes("Reviewing staged"));
});

test("findings carry known metadata and omit absent fields", () => {
  const normalized = [
    {
      filePath: "src/a.ts",
      line: 3,
      severity: "WARNING" as const,
      message: "m",
      suggestion: "x",
      category: "c",
    },
  ];
  const panel = toPanelFindings(normalized);
  assert.deepEqual(panel, [
    {
      filePath: "src/a.ts",
      line: 3,
      severity: "WARNING",
      message: "m",
      suggestion: "x",
      category: "c",
    },
  ]);
  // Absent optional fields are not present as undefined keys.
  assert.ok(!("evidence" in panel[0]!));
  assert.ok(!("cached" in panel[0]!));
});

test("severity counts are correct", () => {
  assert.deepEqual(countBySeverity(sampleFindings), { critical: 1, warning: 1, info: 1 });
});

test("findings group by file preserving first-seen order", () => {
  const groups = groupFindingsByFile(sampleFindings);
  assert.deepEqual(
    groups.map((g) => [g.filePath, g.findings.length]),
    [
      ["src/a.ts", 2],
      ["src/b.ts", 1],
    ],
  );
});

test("results render counters and clickable findings with file/line data", () => {
  const html = render({
    ...INITIAL_PANEL_STATE,
    findings: sampleFindings,
    result: {
      kind: "review",
      status: "FAIL",
      critical: 1,
      warning: 1,
      info: 1,
      auditedFiles: 2,
      totalFiles: 2,
    },
  });
  assert.ok(html.includes("1 critical"));
  assert.ok(html.includes('data-file="src/a.ts"'));
  assert.ok(html.includes('data-line="10"'));
  assert.ok(html.includes("FAIL"));
});

test("renders severity filters, all selected by default", () => {
  const html = render({ ...INITIAL_PANEL_STATE, findings: sampleFindings });
  for (const sev of ["error", "warning", "info"]) {
    assert.ok(html.includes(`data-sev="${sev}"`), `expected a filter for ${sev}`);
  }
  // All three filter checkboxes are checked by default.
  const checked = html.match(/class="sev-filter"[^>]*checked/g) ?? [];
  assert.equal(checked.length, 3);
});

test("renders collapsible file groups expanded by default", () => {
  const html = render({ ...INITIAL_PANEL_STATE, findings: sampleFindings });
  assert.ok(html.includes('class="file-head"'));
  assert.ok(html.includes('aria-expanded="true"'));
  assert.ok(html.includes('class="file-body"'));
  // Expand/Collapse All controls exist.
  assert.ok(html.includes('id="expand-all"'));
  assert.ok(html.includes('id="collapse-all"'));
});

test("renders finding metadata detail with HTML escaping", () => {
  const html = render({
    ...INITIAL_PANEL_STATE,
    findings: [
      {
        filePath: "src/a.ts",
        line: 7,
        severity: "CRITICAL",
        message: "boom",
        category: "security",
        confidence: "high",
        evidence: "<script>evil()</script>",
        suggestion: "Sanitize input",
        codeSuggestion: "const safe = escape(x);",
        cached: true,
      },
    ],
  });
  assert.ok(html.includes("security/high"));
  assert.ok(html.includes("Sanitize input"));
  assert.ok(html.includes("const safe = escape(x);"));
  assert.ok(html.includes("served from cache"));
  // Evidence is escaped, not injected.
  assert.ok(html.includes("&lt;script&gt;evil()"));
  assert.ok(!html.includes("<script>evil()"));
});

test("Open action carries file/line and the script posts an open message", () => {
  const html = render({ ...INITIAL_PANEL_STATE, findings: sampleFindings });
  assert.ok(html.includes('class="open"'));
  assert.ok(html.includes('data-file="src/a.ts"'));
  assert.ok(html.includes('data-line="10"'));
  assert.ok(html.includes("type: 'open'"));
});

test("layout uses a fixed header/footer with a scroll-only results region", () => {
  const html = render({ ...INITIAL_PANEL_STATE, findings: sampleFindings });
  assert.ok(html.includes('class="panel"'));
  assert.ok(html.includes('class="top"'));
  assert.ok(html.includes('class="results scroll"'));
  // The scroll region carries the file groups; controls live in the fixed top.
  const topIdx = html.indexOf('class="top"');
  const scrollIdx = html.indexOf('class="results scroll"');
  assert.ok(topIdx < scrollIdx);
  assert.ok(html.indexOf('class="filters"') < scrollIdx); // filters are in the header
  assert.ok(html.indexOf('class="file-group"') > scrollIdx); // groups are in the scroll
  // CSS makes only the results region scroll.
  assert.ok(html.includes(".results.scroll"));
  assert.ok(html.includes("overflow-y: auto"));
});

test("role-button links are keyboard-activatable (Enter/Space)", () => {
  const html = render({ ...INITIAL_PANEL_STATE, findings: sampleFindings });
  // The script defines a shared activation helper and wires the role-button
  // links through it (so Enter/Space work, not just mouse click).
  assert.ok(html.includes("const onActivate"));
  assert.ok(html.includes("e.key === 'Enter'"));
  assert.ok(html.includes("e.key === ' '"));
  assert.ok(html.includes("onActivate(document.getElementById('expand-all')"));
  assert.ok(html.includes("onActivate(document.getElementById('clear-findings')"));
});

test("CSP + nonce guard: every inline script/style is nonce-gated", () => {
  const html = render(INITIAL_PANEL_STATE);
  assert.ok(html.includes("Content-Security-Policy"));
  assert.ok(html.includes(`script-src 'nonce-${NONCE}'`));
  assert.ok(html.includes(`style-src 'nonce-${NONCE}'`));
  assert.ok(html.includes(`<script nonce="${NONCE}">`));
  assert.ok(html.includes(`<style nonce="${NONCE}">`));
  // No ungated <script> tag may exist.
  assert.equal(/<script(?! nonce=)/.test(html), false);
});

test("user-supplied content is HTML-escaped to prevent injection", () => {
  const html = render({
    ...INITIAL_PANEL_STATE,
    findings: [
      { filePath: "src/x.ts", line: 1, severity: "INFO", message: "<img src=x onerror=alert(1)>" },
    ],
  });
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;img"));
});

test("view id constant is the namespaced panel id", () => {
  assert.equal(PANEL_VIEW_ID, "mpSentinel.panel");
});

test("the panel exposes the branch-diff command as a primary action", () => {
  const html = render(INITIAL_PANEL_STATE);
  assert.ok(html.includes('data-command="mpSentinel.reviewBranchDiff"'));
  assert.ok(html.includes("Review Branch vs Base"));
});

test("a stale index is surfaced as a non-blocking warning", () => {
  const html = render({ ...INITIAL_PANEL_STATE, indexHealth: "stale" });
  assert.ok(html.includes("warn-banner"));
  assert.ok(html.includes("rebuild recommended before review"));
  assert.ok(html.includes("stale"));
});

test("a healthy index shows a quiet meta line, no warning", () => {
  const html = render({ ...INITIAL_PANEL_STATE, indexHealth: "ok" });
  assert.ok(html.includes("index: ok"));
  // "warn-banner" also appears in the inline CSS, so assert on the banner text.
  assert.ok(!html.includes("rebuild recommended before review"));
});

test("the panel exposes a Configure AI action", () => {
  const html = render(INITIAL_PANEL_STATE);
  assert.ok(html.includes('data-command="mpSentinel.selectProvider"'));
  assert.ok(html.includes("Configure AI"));
});

test("AI status is rendered and HTML-escaped", () => {
  const html = render({
    ...INITIAL_PANEL_STATE,
    aiStatus: "AI: anthropic / <b>m</b> · key: configured",
  });
  assert.ok(html.includes("AI: anthropic"));
  assert.ok(html.includes("&lt;b&gt;"));
  assert.ok(!html.includes("<b>m</b>"));
});
