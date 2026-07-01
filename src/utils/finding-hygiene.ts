/**
 * Finding hygiene — self-negation filter.
 *
 * Field testing showed models emitting findings whose own message concludes
 * nothing is wrong ("…however, these hooks are already wrapped, so this is
 * compliant. No issue.") or hedges the claim away ("this is a false positive
 * risk rather than a crash"). Shipping these wastes reviewer attention and
 * inflates counts.
 *
 * Policy (conservative):
 *   - WARNING/INFO with a self-negating message → DROPPED.
 *   - CRITICAL with a self-negating message → kept but downgraded to INFO and
 *     tagged `[self-negated]` — visible for prompt tuning, never blocking.
 *
 * Only applied to AI findings (deterministic evaluators never self-negate).
 */

import type { AuditIssue, FileAuditResult } from "../types/index.js";

const SELF_NEGATION_PATTERNS: readonly RegExp[] = [
  /\bno (real |actual )?issue\b/i,
  /\b(?:this|which|that|it) is compliant\b/i,
  /\bnot (actually )?a problem\b/i,
  /\bfalse positive\b/i,
  /\bthis is (acceptable|fine|correct|intentional|expected|safe)\b/i,
  /\bno (action|change|fix) (is )?(needed|required)\b/i,
  /\bworks as intended\b/i,
  // Hedged variants observed in the field: the model raises the finding,
  // then concedes it is probably fine pending verification.
  /\bthis may be (acceptable|fine|intentional|compliant|correct)\b/i,
  /\bif (they|it|this|these) (are|is)[^.]*\bcompliant\b/i,
  /\blikely (intentional|acceptable|fine|a false positive)\b/i,
];

/**
 * A finding negates itself when its own prose concludes (or strongly hedges
 * toward) "nothing is wrong". Both message and suggestion are checked — field
 * samples put the concession in either field.
 */
export const isSelfNegating = (message: string, suggestion?: string): boolean =>
  SELF_NEGATION_PATTERNS.some(
    (pattern) => pattern.test(message) || (suggestion !== undefined && pattern.test(suggestion)),
  );

export interface HygieneResult {
  results: FileAuditResult[];
  dropped: number;
  downgraded: number;
}

const downgradeSelfNegated = (issue: AuditIssue): AuditIssue => ({
  ...issue,
  severity: "INFO",
  confidence: "low",
  message: `${issue.message} [self-negated]`,
});

// ── XSS sink verification ───────────────────────────────────────────────

/**
 * Actual XSS sinks. JSX text interpolation auto-escapes, so an XSS CRITICAL
 * is only credible when its evidence quotes one of these.
 */
const XSS_SINK_RE =
  /dangerouslySetInnerHTML|\binnerHTML\s*=|insertAdjacentHTML|document\.write|DOMParser|parseFromString|createContextualFragment|createElement|eval\s*\(|javascript:/i;

const isXssClaim = (issue: AuditIssue): boolean =>
  issue.severity === "CRITICAL" &&
  issue.category === "security" &&
  /\bXSS\b|cross-site scripting/i.test(issue.message);

/**
 * Downgrade CRITICAL XSS claims whose evidence contains no actual sink —
 * the dominant false-positive class is "JSX renders user content without
 * sanitization", which React already escapes. Claims WITHOUT evidence are
 * also downgraded (the prompt requires CRITICALs to quote the sink).
 */
export const downgradeUnsinkedXssClaims = (
  results: readonly FileAuditResult[],
): { results: FileAuditResult[]; downgraded: number } => {
  let downgraded = 0;
  const next = results.map((file): FileAuditResult => {
    const issues = file.result.issues ?? [];
    if (!issues.some(isXssClaim)) return file;

    const nextIssues = issues.map((issue): AuditIssue => {
      if (!isXssClaim(issue)) return issue;
      if (issue.evidence && XSS_SINK_RE.test(issue.evidence)) return issue;
      downgraded += 1;
      return {
        ...issue,
        severity: "WARNING",
        confidence: "low",
        message: `${issue.message} [downgraded: no XSS sink in evidence — JSX interpolation auto-escapes]`,
      };
    });
    return { ...file, result: { ...file.result, issues: nextIssues } };
  });
  return { results: next, downgraded };
};

// ── defensive-code XSS guard (guard/sanitizer vs. unsafe sink) ──────────────

/**
 * Evidence that DEFENDS against an XSS payload rather than emitting one:
 * a check/comparison against the dangerous value, or a sanitizer call.
 * e.g. `if (/^\s*javascript:/i.test(attr.value)) return;` — the line is the
 * guard, not the sink. Field sample: SafeHtml.tsx L31 (temp.md 2026-06-26).
 */
const DEFENSIVE_EVIDENCE_RE =
  /\.(test|match|includes|indexOf|search|startsWith|endsWith)\s*\(|[!=]==|\bDOMPurify\b|\bsanitize(?:Html)?\s*\(|\.removeAttribute\s*\(/i;

/**
 * Evidence of an ACTUAL unsafe assignment into a sink. When present we never
 * treat the line as defensive — `if (cond) el.innerHTML = x` is still a sink.
 */
const UNSAFE_ASSIGN_RE =
  /\binnerHTML\s*=|\bouterHTML\s*=|insertAdjacentHTML|document\.write|dangerouslySetInnerHTML|\.src\s*=|setAttribute\s*\(\s*['"](?:href|src|action|formaction)/i;

/**
 * Downgrade XSS CRITICALs whose evidence is a guard/check/sanitizer rather
 * than an unsafe sink. The plain `downgradeUnsinkedXssClaims` keeps any finding
 * whose evidence merely MENTIONS a sink token (`javascript:`, `DOMParser`…),
 * which lets a defensive line that checks for `javascript:` survive as a false
 * CRITICAL. This pass closes that gap: defensive evidence (and no unsafe
 * assignment) downgrades to WARNING for human review.
 */
export const downgradeDefensiveXssClaims = (
  results: readonly FileAuditResult[],
): { results: FileAuditResult[]; downgraded: number } => {
  let downgraded = 0;
  const next = results.map((file): FileAuditResult => {
    const issues = file.result.issues ?? [];
    if (!issues.some(isXssClaim)) return file;

    const nextIssues = issues.map((issue): AuditIssue => {
      if (!isXssClaim(issue) || !issue.evidence) return issue;
      const ev = issue.evidence;
      if (!DEFENSIVE_EVIDENCE_RE.test(ev) || UNSAFE_ASSIGN_RE.test(ev)) return issue;
      downgraded += 1;
      return {
        ...issue,
        severity: "WARNING",
        confidence: "low",
        message: `${issue.message} [downgraded: evidence is a guard/sanitizer, not an unsafe sink]`,
      };
    });
    return { ...file, result: { ...file.result, issues: nextIssues } };
  });
  return { results: next, downgraded };
};

// ── weak-random reclassification (security vs. non-security use) ─────────────

const WEAK_RANDOM_RE = /Math\.random\s*\(/;

/**
 * Identifiers whose value is genuinely security-sensitive — only THEN is
 * `Math.random()` a security defect. A UI row key, temp id, color seed, or
 * jitter value is not. Field sample: useMyRequestCreate.ts L27 (`rowId`).
 */
const SECURITY_CONTEXT_RE =
  /\b(token|secret|api[_-]?key|apikey|password|passwd|pwd|session|csrf|xsrf|nonce|salt|\biv\b|otp|auth|credential|signature|jwt|cookie)\b/i;

/**
 * Categories that over-fire on `Math.random()`. Besides the security/crypto
 * framing, the model also raises it as a runtime-crash/performance CRITICAL
 * ("used as a React key → remounts every render → lost state"). That claim
 * requires the value to be produced DURING render and used as a `key`; when
 * it is generated once (e.g. inside a `useEffect`/initializer) it is stable,
 * so the crash framing is unverifiable from the single evidence line. Field
 * sample: useMyRequestCreate.ts L23 (review-0626.md, the lone CRITICAL).
 */
const WEAK_RANDOM_CATEGORIES = new Set(["security", "runtime-crash", "performance"]);

const isWeakRandomMisclassification = (issue: AuditIssue): boolean =>
  issue.severity !== "INFO" &&
  issue.evidence !== undefined &&
  WEAK_RANDOM_RE.test(issue.evidence) &&
  ((issue.category !== undefined && WEAK_RANDOM_CATEGORIES.has(issue.category)) ||
    /cryptographic|secure random|insecure random|remount/i.test(issue.message));

/**
 * Reclassify `Math.random()` findings raised as security / runtime-crash /
 * performance when neither the evidence nor the message ties the value to a
 * security-sensitive identifier. Recategorized to maintainability and capped
 * at WARNING (never CRITICAL) — `crypto.randomUUID()` is a nicety here, not a
 * security fix or a crash.
 */
export const reclassifyWeakRandomFindings = (
  results: readonly FileAuditResult[],
): { results: FileAuditResult[]; reclassified: number } => {
  let reclassified = 0;
  const next = results.map((file): FileAuditResult => {
    const issues = file.result.issues ?? [];
    if (!issues.some(isWeakRandomMisclassification)) return file;

    const nextIssues = issues.map((issue): AuditIssue => {
      if (!isWeakRandomMisclassification(issue)) return issue;
      const haystack = `${issue.evidence ?? ""} ${issue.message}`;
      if (SECURITY_CONTEXT_RE.test(haystack)) return issue;
      reclassified += 1;
      const severity = issue.severity === "CRITICAL" ? "WARNING" : issue.severity;
      return {
        ...issue,
        severity,
        category: "maintainability",
        confidence: "low",
        message: `${issue.message} [reclassified: non-security Math.random (UI/local id) → maintainability]`,
      };
    });
    return { ...file, result: { ...file.result, issues: nextIssues } };
  });
  return { results: next, reclassified };
};

// ── claim-vs-evidence verb mismatch ─────────────────────────────────────────

const EVIDENCE_DELETE_RE = /\.(delete|del|remove|destroy)\s*\(|method\s*:\s*['"]delete['"]/i;
const CLAIM_UPDATE_EFFECT_RE = /\b(update|updates|updating|mutat|overwrit|modif)/i;

const hasVerbMismatch = (issue: AuditIssue): boolean =>
  issue.severity !== "INFO" &&
  issue.evidence !== undefined &&
  EVIDENCE_DELETE_RE.test(issue.evidence) &&
  CLAIM_UPDATE_EFFECT_RE.test(issue.message);

/**
 * Downgrade findings whose stated mechanism contradicts the verb in their own
 * evidence — e.g. "causes unintended updates instead of deletions" quoting
 * `apiClient.delete(...)`. The DELETE verb means it will not update; the claim
 * is wrong even if the endpoint constant is misnamed. Kept as WARNING for
 * human review (the naming concern may be real). Field sample: typeGroupsApi.ts
 * L39 (temp.md 2026-06-26).
 */
export const flagVerbMismatchClaims = (
  results: readonly FileAuditResult[],
): { results: FileAuditResult[]; downgraded: number } => {
  let downgraded = 0;
  const next = results.map((file): FileAuditResult => {
    const issues = file.result.issues ?? [];
    if (!issues.some(hasVerbMismatch)) return file;

    const nextIssues = issues.map((issue): AuditIssue => {
      if (!hasVerbMismatch(issue)) return issue;
      downgraded += 1;
      const severity = issue.severity === "CRITICAL" ? "WARNING" : issue.severity;
      return {
        ...issue,
        severity,
        confidence: "low",
        message: `${issue.message} [needs-human-review: evidence uses DELETE verb but claim asserts an update — verify endpoint method/naming]`,
      };
    });
    return { ...file, result: { ...file.result, issues: nextIssues } };
  });
  return { results: next, downgraded };
};

// ── barrel re-export claims (invisible in a diff) ───────────────────────────

/**
 * Claim that a symbol is NOT exported by a barrel/index. A barrel re-exports
 * transitively (`index.ts` → `feedback/index.ts` → `Toast.tsx`), and none of
 * that chain is visible in a diff, so "X is not exported by the barrel" is
 * unverifiable and a frequent false positive. Field sample: MyRequestListPage
 * L1 — "message is not a UI primitive exported by the GEMS UI barrel" (it is,
 * via the feedback re-export). review-0626.md.
 *
 * Note: this is narrow on purpose. The VALID sibling findings — "imported from
 * 'antd', import from the gems-ui barrel instead" / "imported from a deep path
 * instead of the public barrel" — do NOT assert "not exported", so they pass
 * through untouched.
 */
const BARREL_NOT_EXPORTED_RE =
  /\bnot\s+(?:a\s+\w+\s+|an?\s+)?(?:ui\s+)?(?:primitive\s+)?(?:re-?)?export(?:ed)?\b|\bis\s+not\s+exported\b|\bnot\s+(?:re-?)?exported\s+(?:by|from)\b/i;
const BARREL_REF_RE = /\bbarrel\b|gems-ui|index\.ts|@\/shared/i;

const isBarrelNotExportedClaim = (issue: AuditIssue): boolean =>
  issue.severity !== "INFO" &&
  BARREL_NOT_EXPORTED_RE.test(issue.message) &&
  (BARREL_REF_RE.test(issue.message) ||
    (issue.evidence !== undefined && BARREL_REF_RE.test(issue.evidence)));

/**
 * Downgrade "symbol not exported by the barrel" claims to INFO — the reviewer
 * cannot see a barrel's transitive re-exports from a diff, so the assertion is
 * unverifiable. Kept visible (INFO) for human confirmation, never blocking.
 */
export const downgradeBarrelExportClaims = (
  results: readonly FileAuditResult[],
): { results: FileAuditResult[]; downgraded: number } => {
  let downgraded = 0;
  const next = results.map((file): FileAuditResult => {
    const issues = file.result.issues ?? [];
    if (!issues.some(isBarrelNotExportedClaim)) return file;

    const nextIssues = issues.map((issue): AuditIssue => {
      if (!isBarrelNotExportedClaim(issue)) return issue;
      downgraded += 1;
      return {
        ...issue,
        severity: "INFO",
        confidence: "low",
        message: `${issue.message} [downgraded: barrel re-exports are not visible in a diff — verify against the barrel index]`,
      };
    });
    return { ...file, result: { ...file.result, issues: nextIssues } };
  });
  return { results: next, downgraded };
};

// ── build-break / syntax-error claims (caught deterministically) ────────────

/**
 * The model sometimes escalates a stylistic or lint-level issue to CRITICAL by
 * asserting it "breaks the build" / "is a syntax error". Field sample:
 * SystemFieldCanvas.tsx L25 — "misplaced import statement causes a syntax error
 * … will break the build" (review-0701.md). In ES modules `import` declarations
 * are hoisted and valid anywhere at the top level, so the file compiles fine.
 *
 * A genuine syntax/build break is caught deterministically by `tsc`, ESLint and
 * CI — it is not something an AI reviewer should assert as CRITICAL from a
 * single hunk. So a CRITICAL whose claim rests on "won't compile / breaks the
 * build / syntax error" is downgraded to WARNING for typecheck/CI to confirm.
 * Kept visible, never dropped.
 */
const BUILD_BREAK_RE =
  /\b(syntax error|will (?:break|fail) the build|breaks? the build|won'?t compile|will not compile|fails? to compile|does not compile|compilation (?:error|failure)|import (?:declarations? )?must be at the top|misplaced import)\b/i;

const isBuildBreakClaim = (issue: AuditIssue): boolean =>
  issue.severity === "CRITICAL" && BUILD_BREAK_RE.test(issue.message);

/**
 * Downgrade CRITICAL "breaks the build / syntax error" claims to WARNING —
 * build/compile breakage is verified deterministically (typecheck, lint, CI),
 * not by AI inspection of a diff, so these over-severity CRITICALs should not
 * block. Tagged for human/CI confirmation.
 */
export const downgradeBuildBreakClaims = (
  results: readonly FileAuditResult[],
): { results: FileAuditResult[]; downgraded: number } => {
  let downgraded = 0;
  const next = results.map((file): FileAuditResult => {
    const issues = file.result.issues ?? [];
    if (!issues.some(isBuildBreakClaim)) return file;

    const nextIssues = issues.map((issue): AuditIssue => {
      if (!isBuildBreakClaim(issue)) return issue;
      downgraded += 1;
      return {
        ...issue,
        severity: "WARNING",
        confidence: "low",
        message: `${issue.message} [downgraded: build/syntax breakage is caught deterministically by typecheck/lint — verify]`,
      };
    });
    return { ...file, result: { ...file.result, issues: nextIssues } };
  });
  return { results: next, downgraded };
};

/**
 * Remove or downgrade findings whose message negates itself.
 */
export const filterSelfNegatedFindings = (results: readonly FileAuditResult[]): HygieneResult => {
  let dropped = 0;
  let downgraded = 0;

  const next = results.map((file): FileAuditResult => {
    const issues = file.result.issues ?? [];
    if (!issues.some((issue) => isSelfNegating(issue.message, issue.suggestion))) return file;

    const kept: AuditIssue[] = [];
    for (const issue of issues) {
      if (!isSelfNegating(issue.message, issue.suggestion)) {
        kept.push(issue);
        continue;
      }
      if (issue.severity === "CRITICAL") {
        downgraded += 1;
        kept.push(downgradeSelfNegated(issue));
      } else {
        dropped += 1;
      }
    }
    return { ...file, result: { ...file.result, issues: kept } };
  });

  return { results: next, dropped, downgraded };
};
