/**
 * Inline CSS and the nonce-gated webview script for the side panel. Kept in one
 * place so the render module stays focused on markup. No external assets — both
 * strings are injected under the per-render nonce by `renderPanelHtml`.
 */

export const PANEL_STYLE = `
  html, body { height: 100%; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); margin: 0; }
  /* Fixed header + footer; only the results list scrolls. */
  .panel { display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; padding: 8px; }
  .top { flex: 0 0 auto; }
  .results.scroll { flex: 1 1 auto; overflow-y: auto; min-height: 0; }
  .status { font-weight: 600; margin-bottom: 4px; }
  .status.running { color: var(--vscode-charts-blue); }
  .meta { opacity: 0.75; font-size: 0.9em; margin-bottom: 6px; }
  .warn-banner { color: var(--vscode-editorWarning-foreground); font-size: 0.9em; margin: 4px 0; }
  .actions { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0; }
  .actions.maint { border-top: 1px solid var(--vscode-panel-border); padding-top: 6px; }
  button.act { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 4px 8px; border-radius: 2px; cursor: pointer; font-size: 0.9em; }
  button.act:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .counters { display: flex; flex-wrap: wrap; gap: 4px; margin: 8px 0; }
  .pill { padding: 1px 6px; border-radius: 8px; font-size: 0.85em; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .pill.status-ok { background: var(--vscode-testing-iconPassed); color: var(--vscode-editor-background); }
  .pill.status-bad { background: var(--vscode-errorForeground); color: var(--vscode-editor-background); }
  .empty { opacity: 0.7; margin: 8px 0; }
  .filters { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px; align-items: center; margin: 6px 0; font-size: 0.9em; }
  .sev-toggles { display: flex; gap: 8px; }
  .sev-toggle { cursor: pointer; }
  .group-actions a { color: var(--vscode-textLink-foreground); cursor: pointer; margin-left: 8px; }
  .file-group { margin-top: 8px; }
  .file-head { width: 100%; text-align: left; background: none; border: none; color: var(--vscode-foreground); font: inherit; font-weight: 600; opacity: 0.9; cursor: pointer; padding: 2px 0; }
  .file-head .count { opacity: 0.6; font-weight: 400; }
  .file-head .caret { display: inline-block; width: 1em; }
  .file-group.collapsed .file-body { display: none; }
  .finding { padding: 2px 4px; border-radius: 2px; }
  .finding-row { display: flex; align-items: baseline; gap: 6px; }
  .finding-row:hover { background: var(--vscode-list-hoverBackground); }
  .sev { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex: 0 0 auto; }
  .sev.sev-error { background: var(--vscode-errorForeground); }
  .sev.sev-warning { background: var(--vscode-editorWarning-foreground); }
  .sev.sev-info { background: var(--vscode-charts-blue); }
  .loc { opacity: 0.6; font-variant-numeric: tabular-nums; }
  .tag { opacity: 0.7; font-size: 0.85em; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 6px; padding: 0 5px; }
  .msg { flex: 1; }
  .open { color: var(--vscode-textLink-foreground); cursor: pointer; flex: 0 0 auto; }
  .finding-detail { margin: 2px 0 6px 18px; font-size: 0.9em; opacity: 0.85; }
  .finding-detail pre { white-space: pre-wrap; background: var(--vscode-textCodeBlock-background); padding: 4px 6px; border-radius: 2px; margin: 2px 0; }
  .finding-detail .d-cached { font-style: italic; opacity: 0.7; }
  .finding.hidden { display: none; }
  footer { display: flex; gap: 8px; margin-top: 10px; border-top: 1px solid var(--vscode-panel-border); padding-top: 6px; }
  footer a { color: var(--vscode-textLink-foreground); cursor: pointer; font-size: 0.9em; }
`;

export const PANEL_SCRIPT = `
  const vscode = acquireVsCodeApi();

  // Keyboard activation for role="button" links: Enter / Space trigger the
  // action, matching native <button> behavior.
  const onActivate = (el, fn) => {
    if (!el) return;
    el.addEventListener('click', fn);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
    });
  };

  for (const el of document.querySelectorAll('[data-command]')) {
    el.addEventListener('click', () => vscode.postMessage({ type: 'command', command: el.dataset.command }));
  }

  // Open finding at file/line.
  for (const el of document.querySelectorAll('.open[data-file]')) {
    const open = () => vscode.postMessage({ type: 'open', file: el.dataset.file, line: Number(el.dataset.line) });
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  }

  // Collapsible file groups.
  for (const head of document.querySelectorAll('.file-head')) {
    const group = head.closest('.file-group');
    head.addEventListener('click', () => {
      const collapsed = group.classList.toggle('collapsed');
      head.setAttribute('aria-expanded', String(!collapsed));
      const caret = head.querySelector('.caret');
      if (caret) caret.textContent = collapsed ? '▸' : '▾';
    });
  }
  const setAll = (collapsed) => {
    for (const group of document.querySelectorAll('.file-group')) {
      group.classList.toggle('collapsed', collapsed);
      const head = group.querySelector('.file-head');
      if (head) head.setAttribute('aria-expanded', String(!collapsed));
      const caret = group.querySelector('.caret');
      if (caret) caret.textContent = collapsed ? '▸' : '▾';
    }
  };
  onActivate(document.getElementById('expand-all'), () => setAll(false));
  onActivate(document.getElementById('collapse-all'), () => setAll(true));

  // Severity filter (UI-only; never touches diagnostics).
  const applyFilters = () => {
    const active = new Set();
    for (const cb of document.querySelectorAll('.sev-filter')) {
      if (cb.checked) active.add(cb.dataset.sev);
    }
    for (const finding of document.querySelectorAll('.finding')) {
      finding.classList.toggle('hidden', !active.has(finding.dataset.sev));
    }
    // Hide a file group whose findings are all filtered out.
    for (const group of document.querySelectorAll('.file-group')) {
      const anyVisible = group.querySelector('.finding:not(.hidden)') !== null;
      group.style.display = anyVisible ? '' : 'none';
    }
  };
  for (const cb of document.querySelectorAll('.sev-filter')) {
    cb.addEventListener('change', applyFilters);
  }

  onActivate(document.getElementById('show-output'), () => vscode.postMessage({ type: 'output' }));
  onActivate(document.getElementById('clear-findings'), () =>
    vscode.postMessage({ type: 'clearDiagnostics' }),
  );
`;
