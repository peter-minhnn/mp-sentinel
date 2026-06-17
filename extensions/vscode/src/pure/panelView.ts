/**
 * Public entrypoint (barrel) for the side-panel view. The implementation is
 * split across small sibling modules to stay well under the repo's file-size
 * threshold:
 *   - panelViewModel.ts  — types, ids, grouping, counts, toPanelFindings
 *   - panelViewRender.ts — HTML rendering (renderPanelHtml, escapeHtml)
 *   - panelViewAssets.ts — inline CSS + nonce-gated script (internal)
 *
 * Existing imports of `./panelView.js` keep working unchanged.
 */

export * from "./panelViewModel.js";
export * from "./panelViewRender.js";
