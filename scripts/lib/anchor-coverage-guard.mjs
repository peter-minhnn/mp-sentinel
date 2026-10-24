/** Safety proxy, not semantic intent detection: retain supported baseline anchors. */
export function guardAnchorCoverage({ baseline, proposal, trace, anchors }) {
  const wanted = new Set(anchors);
  const supported = (capsule) => {
    const opened = new Set(capsule.files.map((file) => file.file));
    return new Set(
      trace
        .filter((file) => opened.has(file.file) && !file.graphOnly)
        .flatMap((file) =>
          file.contributions
            .filter((hit) => hit.rrf > 0 && wanted.has(hit.anchor))
            .map((hit) => hit.anchor),
        ),
    );
  };
  const before = supported(baseline);
  const after = supported(proposal);
  const lost = [...before].filter((anchor) => !after.has(anchor));
  const fallback = before.size === 0 || lost.length > 0;
  return {
    capsule: fallback ? baseline : proposal,
    diagnostic: {
      fallback,
      reason:
        before.size === 0
          ? "no-supported-baseline-anchor"
          : lost.length
            ? "baseline-anchor-coverage-drop"
            : "coverage-preserved",
      baselineCovered: [...before],
      proposedCovered: [...after],
      lost,
    },
  };
}
