# Plan: Review Accuracy Hardening

> **Status (2026-06-12):**
> ✅ Phase 1 hoàn thành (severity clamp, evidence verification, commit metadata, `--no-cache`)
> ✅ Phase 2 hoàn thành (HEAD reconciliation cho `--commit`, active-only exit semantics, "Resolved During Branch" section)
> ✅ Phase 3 một phần: contextLines 2→8, confidence gating, category-specific prompt checklist
> ⏳ Còn lại: 3.1 enclosing-symbol context từ source-index + full-file <300 dòng, 3.4 circuit-breaker UNREVIEWED/resume UX

> **Ngày:** 2026-06-12
> **Nguồn gốc:** Benchmark 2 report thực tế trên gems-e-approval-web
> (`feat/booking-mgt` và `feat/init-layout` của tungnguyen).
> **Kết quả benchmark:** Critical precision 75%, severity calibration ~42%,
> actionability của "Immediate" list chỉ 29% (2/7 mục còn đúng tại HEAD).

---

## Root Causes (đối chiếu source hiện tại)

| # | Root cause | Bằng chứng từ benchmark | Vị trí trong source |
|---|---|---|---|
| RC1 | **Không reconcile findings với HEAD** — review per-commit gom finding của commit cũ, đã fix ở commit sau nhưng vẫn nằm trong action list | 3/5 critical (booking-mgt) và 3/12 critical (init-layout) đã fix tại HEAD nhưng vẫn ở "Top Priority Before Merge" | Không tồn tại — `dedupe-findings.ts` chỉ dedup exact-duplicate trong 1 file |
| RC2 | **Cross-commit dedup không phải tính năng của tool** — report agent tự suy luận và đảo ngược thứ tự chronology (`git log` newest-first đọc thành oldest-first) | Dedup table claim "e0a0f0e resolved by 1cfb286" trong khi 1cfb286 cũ hơn 2 ngày | Tool không emit commit timestamp/order trong output |
| RC3 | **Context blindness** — AI chỉ thấy diff hunk (`contextLines: 2`), không thấy guard phía trên, import đầu file, props của component | 3 false positive: null-deref có guard ngay trên (`CompanyBoardDetailPage`), `ReferenceError` nhưng `getCompanyId()` đã import (`dashboardApi`), Tree crash nhưng không có `checkStrictly` | `collectReviewInput` (`src/utils/git.ts`), `contextLines = 2` default |
| RC4 | **Severity inflation** — rule architecture/style bị gắn CRITICAL | 4/12 critical là "inline endpoint string" (rule style) | Prompt không có rubric category→severity; không có post-clamp (`src/config/prompts.ts`) |
| RC5 | **Cache provenance không minh bạch** — nghi finding cũ từ `.mp-sentinel-cache` lẫn vào run mới | Report booking-mgt chứa finding của code đã sửa dù chạy `--files` trên HEAD | `src/services/ai/cache.ts`, cache-backends |
| RC6 | **Circuit breaker để lại review không hoàn chỉnh, không actionable** | 49/63 files của 2 commit không được review, chỉ ghi chú "consider re-running" | `src/services/ai/circuit-breaker.ts` |
| RC7 | **Finding neo theo line number** — line drift giữa các commit làm khó verify | `auth-helper.ts` báo L134, thực tế L127 | `audit-schema.ts` có field `evidence` nhưng không enforce |

---

## Phase 1 — Quick wins (1–2 ngày)

### 1.1 Severity clamp theo category (RC4)
- Thêm rubric vào prompt (`src/config/prompts.ts`): CRITICAL chỉ cho
  `security` | `runtime-crash`; `architecture`/`maintainability`/`performance` tối đa WARNING.
- Thêm post-pass deterministic clamp sau khi parse AI output
  (mới: `src/utils/severity-clamp.ts`), configurable qua
  `.mp-sentinelrc.json → ai.severityCeilings`.
- Test: fixture "inline endpoint bị AI gắn CRITICAL" → clamp xuống WARNING.

### 1.2 Enforce evidence + verify deterministic (RC3, RC7)
- `audit-schema.ts`: bắt buộc `evidence` (quote đúng dòng code) cho mọi finding CRITICAL.
- Post-pass verify: `evidence` phải tồn tại trong file content thật
  (mới: `src/utils/verify-evidence.ts`). Không khớp → downgrade WARNING + tag `unverified`.
- Neo finding theo snippet thay vì chỉ line: khi render report, re-locate
  evidence trong file để in line number hiện tại.

### 1.3 Emit commit metadata machine-readable (RC2)
- Per-commit / branch-diff output thêm: `commitSha`, `committedAt` (ISO),
  `orderIndex` (0 = cũ nhất) vào JSON result (`src/utils/git.ts`,
  `src/cli/local-review.ts`, `src/formatters/report.ts`).
- Markdown report: bảng commit luôn in theo thứ tự chronological (cũ → mới),
  ghi rõ "oldest first".

### 1.4 Cache provenance (RC5)
- Audit cache key: phải gồm content-hash của file + version của prompt + ruleset
  (`src/services/ai/cache.ts`). Thiếu thành phần nào → bổ sung.
- Report ghi rõ per-file: `fresh` | `cache-hit (content unchanged)`.
- Flag `--no-cache` cho run pre-merge chính thức.

---

## Phase 2 — HEAD reconciliation (3–5 ngày) ← fix tận gốc RC1 + RC2

### 2.1 Reconciliation pass sau review
- Mới: `src/services/reconcile-findings.ts`.
- Sau khi có toàn bộ findings (mọi mode), với mỗi finding:
  1. Đọc file tại HEAD (working tree).
  2. Tìm `evidence` snippet trong file.
  3. Không còn → `status: resolved-at-HEAD`, tìm commit fix bằng
     `git log -S"<evidence>"` → ghi `resolvedBy: <sha>`.
  4. Còn → `status: active`.
- Report tách 2 section: **Active findings** (chỉ phần này được vào
  action items) và **Resolved during branch** (lịch sử, không actionable).

### 2.2 Cross-commit dedup native
- Dedup giữa các commit theo key `file + category + normalized evidence`
  (mở rộng `dedupe-findings.ts`), giữ finding ở commit sớm nhất,
  annotate các commit sau.
- Chronology lấy từ `committedAt` đã emit ở 1.3 — không bao giờ để
  LLM/agent tự suy luận thứ tự.

### 2.3 Exit code & summary phản ánh active-only
- `Failed/Critical` count trong executive summary = active findings.
- Giữ exit code contract 0/1/2 (xem AGENTS.md — không đổi semantics).

---

## Phase 3 — Context enrichment + confidence gating (1 tuần)

### 3.1 Enclosing-symbol context (RC3)
- Dùng source-index (`src/services/source-index/context-builder.ts`) để đính kèm
  cho mỗi hunk: body của function/component bao quanh + toàn bộ import của file.
- File < 300 dòng: gửi full file thay vì hunk.
- Nâng `contextLines` default 2 → 8 cho trường hợp không có index.

### 3.2 Category-specific verification checklist trong prompt
- `runtime-crash` null-deref: model phải xác nhận "không có guard trong
  enclosing scope" và quote scope đó.
- `ReferenceError`: phải kiểm tra identifier không có trong imports/params
  (source index đã có symbol table → verify deterministic được).
- Props/API misuse (vd `checkStrictly`): phải quote đủ props của element.

### 3.3 Confidence gating
- CRITICAL yêu cầu `confidence: high` + evidence verified; ngược lại
  auto-downgrade WARNING + tag `needs-human-review`.

### 3.4 Circuit breaker UX (RC6)
- Files bị skip do provider error → section **UNREVIEWED** riêng,
  in sẵn lệnh resume: `mp-sentinel --files <list> --resume <run-id>`.
- Status tổng = `INCOMPLETE` (phân biệt với FAIL/ERROR) khi có file unreviewed.

---

## Regression test suite (chạy xuyên suốt các phase)

Dùng chính 2 case gems làm fixture (anonymize):

| Fixture | Tái hiện | Expect |
|---|---|---|
| `guard-above-hunk` | `if (!x) return` ngay trên dòng `x.foo` bị sửa | KHÔNG báo null-deref |
| `import-in-file` | identifier được import đầu file, hunk không chứa import | KHÔNG báo ReferenceError |
| `prop-dependent-type` | Tree `onCheck` không có `checkStrictly` | KHÔNG báo crash |
| `fixed-in-later-commit` | bug ở commit N, fix ở commit N+2 | `resolved-at-HEAD`, không vào action list |
| `chronology` | 7 commit thứ tự đảo | dedup đúng chiều thời gian |
| `style-as-critical` | inline endpoint | severity ≤ WARNING |

**Acceptance criteria:** Critical precision ≥ 90%, action-list actionability
tại HEAD ≥ 90%, zero chronology inversion.

---

## Process changes phía repo sử dụng (gems)

1. **Pre-merge gate = 1 lần review final-state tại HEAD** (`--files` toàn bộ
   changed files hoặc branch-diff working-tree) với `--no-cache`.
   Per-commit review chỉ dùng tham khảo lịch sử.
2. Report pre-merge phải ghi HEAD SHA tại thời điểm chạy; HEAD đổi → chạy lại.
3. CI (GitLab MR): block merge khi có active CRITICAL.

---

## Thứ tự thực hiện & verify

Mỗi phase tuân thủ checklist AGENTS.md §8:
`npm run format:check && npm run typecheck && npm test && npm run build`.
Không đụng exit-code semantics, `src/index.ts` routing, `.sentinel/skills/`.
