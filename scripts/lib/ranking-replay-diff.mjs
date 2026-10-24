/** Compare observed chains without treating aggregate gains as universal gains. */
export function compareReplay(before, after, arm = "anchored") {
  if (!["anchored", "plain"].includes(arm)) throw new Error("unknown comparison arm");
  if (before.corpus?.sha256 !== after.corpus?.sha256 || !before.corpus?.sha256) {
    throw new Error("cannot compare different or unidentified corpora");
  }
  const oldRun = before.runs?.[0];
  const newRun = after.runs?.[0];
  if (!oldRun || !newRun || before.runs.length !== 1 || after.runs.length !== 1) {
    throw new Error("comparison requires one frozen allocation per report");
  }
  for (const key of ["id", "files", "agentBudget"]) {
    if (oldRun.config[key] !== newRun.config[key]) throw new Error("allocation changed");
  }
  const keyed = (rows) => {
    const map = new Map();
    for (const row of rows) {
      if (map.has(row.query)) throw new Error("duplicate query in report");
      if (!Number.isInteger(row.arms?.[arm]?.kept) || !Number.isInteger(row.evidenceTotal)) {
        throw new Error("missing evidence measurement");
      }
      map.set(row.query, row);
    }
    return map;
  };
  const oldRows = keyed(oldRun.rows);
  const newRows = keyed(newRun.rows);
  if (oldRows.size !== newRows.size || oldRows.size === 0) throw new Error("query set changed");
  const rows = [];
  for (const [query, next] of newRows) {
    const prev = oldRows.get(query);
    if (!prev || prev.evidenceTotal !== next.evidenceTotal) throw new Error("query labels changed");
    const previousKept = prev.arms[arm].kept;
    const currentKept = next.arms[arm].kept;
    rows.push({
      query,
      previousKept,
      currentKept,
      delta: currentKept - previousKept,
      previousOpened: prev.opened,
      currentOpened: next.opened,
      missing: next.arms[arm].missing ?? [],
    });
  }
  return {
    arm,
    corpus: after.corpus,
    previousTool: before.tool,
    currentTool: after.tool,
    indexChanged: before.index?.coreSha256 !== after.index?.coreSha256,
    queries: rows.length,
    improved: rows.filter((row) => row.delta > 0).length,
    regressed: rows.filter((row) => row.delta < 0).length,
    unchanged: rows.filter((row) => row.delta === 0).length,
    netKept: rows.reduce((sum, row) => sum + row.delta, 0),
    rows,
  };
}
