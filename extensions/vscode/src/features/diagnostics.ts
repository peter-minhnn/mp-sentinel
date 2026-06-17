import * as vscode from "vscode";
import {
  groupFindingsByFile,
  normalizeFindings,
  type NormalizedFinding,
  type ReviewReport,
  type Severity,
} from "mp-sentinel-extension-core";

const SEVERITY_MAP: Record<Severity, vscode.DiagnosticSeverity> = {
  CRITICAL: vscode.DiagnosticSeverity.Error,
  WARNING: vscode.DiagnosticSeverity.Warning,
  INFO: vscode.DiagnosticSeverity.Hint,
};

/** Owns the Problems-panel diagnostics produced from review reports. */
export class DiagnosticsManager {
  private readonly collection: vscode.DiagnosticCollection;

  constructor() {
    this.collection = vscode.languages.createDiagnosticCollection("mp-sentinel");
  }

  /**
   * Replaces diagnostics for the files in `report`. Files reviewed but clean
   * have their previous diagnostics cleared.
   *
   * @returns the total number of diagnostics applied.
   */
  applyReport(
    report: ReviewReport,
    folder: vscode.WorkspaceFolder,
    options: { includeInfo: boolean },
  ): number {
    const findings = normalizeFindings(report);
    const filtered = options.includeInfo ? findings : findings.filter((f) => f.severity !== "INFO");
    const byFile = groupFindingsByFile(filtered);

    // Replace the entire previous review's diagnostics so the Problems panel
    // always reflects only the latest report — matching the side panel, which
    // also replaces its findings each run. (Clearing just the reviewed files
    // would leave stale entries from a prior review of other files, drifting the
    // Problems count away from the report/panel.)
    this.collection.clear();

    let total = 0;
    for (const [filePath, fileFindings] of byFile) {
      const uri = this.resolveUri(filePath, folder);
      const diagnostics = fileFindings.map((f) => this.toDiagnostic(f));
      this.collection.set(uri, diagnostics);
      total += diagnostics.length;
    }
    return total;
  }

  clear(): void {
    this.collection.clear();
  }

  dispose(): void {
    this.collection.dispose();
  }

  private resolveUri(filePath: string, folder: vscode.WorkspaceFolder): vscode.Uri {
    return vscode.Uri.joinPath(folder.uri, filePath);
  }

  private toDiagnostic(finding: NormalizedFinding): vscode.Diagnostic {
    const line = Math.max(0, finding.line - 1);
    const range = new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER);

    let message = finding.message;
    if (finding.suggestion) message += `\n\nSuggestion: ${finding.suggestion}`;
    if (finding.codeSuggestion) message += `\n\nProposed fix:\n${finding.codeSuggestion}`;

    const diagnostic = new vscode.Diagnostic(range, message, SEVERITY_MAP[finding.severity]);
    diagnostic.source = "mp-sentinel";
    if (finding.category) {
      diagnostic.code = finding.confidence
        ? `${finding.category}/${finding.confidence}`
        : finding.category;
    }
    return diagnostic;
  }
}
