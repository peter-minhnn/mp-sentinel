# Plan: Review Quality — Phase 4+ (sau field test v3.1.1)

> **Ngày:** 2026-06-12
> **Nguồn gốc:** Field test v3.1.1 trên gems `feat/init-layout` (report `review-0612.txt`,
> 92 files, 7 critical / 438 warning / 58 info, AI = anthropic-gateway/deepseek-v4-pro).
> **Kết quả đạt được:** severity calibration 7/7 critical đúng category security/runtime-crash,
> confidence gating + evidence check hoạt động. **Vấn đề mới phát hiện ở dưới.**

---

## Vấn đề phát hiện từ field test

| # | Vấn đề | Bằng chứng | Trạng thái |
|---|---|---|---|
| P1 | Model trả message/suggestion nhiều dòng → report vỡ layout | Cụm 3–13 dòng trống, dòng evidence mồ côi | ✅ Đã fix (parser `collapseProse`) |
| P2 | Parser drop category `refactor` | `VALID_CATEGORIES` thiếu entry | ✅ Đã fix |
| P3 | **Finding tự phủ định vẫn được emit** | WARNING kết thúc "…this is compliant. **No issue**"; CRITICAL chứa "this is a **false positive risk** rather than a crash" | ⏳ P4.1 |
| P4 | **Near-duplicate findings cùng file/line/category** | 2 CRITICAL XSS giống nhau tại `SafeHtml.tsx:16` (dedup hiện tại chỉ bắt exact-match) | ⏳ P4.2 |
| P5 | **438 warnings = quá tải người đọc** — i18n/hex-color/inline-type tràn ngập, không có grouping | Findings section dài >1000 dòng console | ⏳ P4.3 |
| P6 | Local mode không xuất được report file sạch | User phải `tee` → file đầy ANSI escape codes | ⏳ P4.4 |
| P7 | CRITICAL `confidence: medium` với lập luận yếu vẫn qua gate | Gate hiện tại chỉ downgrade `low` | ⏳ P5.1 |

Cộng 2 mục còn nợ từ plan cũ: enclosing-symbol context (3.1) và circuit-breaker
UNREVIEWED/resume (3.4).

---

## Phase 4 — Noise & output (ưu tiên cao, 1–2 ngày)

### 4.1 Self-negation filter (P3)
- Post-pass sau parse (mở rộng `src/utils/parser.ts` hoặc util mới
  `src/utils/finding-hygiene.ts`): drop finding khi message khớp các pattern
  tự phủ định ở cuối câu: `no issue`, `this is compliant`, `not a problem`,
  `false positive`, `however,? this is (acceptable|fine|correct)`.
- CRITICAL chứa self-negation → không drop hẳn mà downgrade INFO + tag
  `[self-negated]` (giữ vết để tune prompt).
- Đếm số dropped/downgraded, log một dòng. Test với 2 mẫu thật từ review-0612.

### 4.2 Near-duplicate collapse (P4)
- Mở rộng `dedupe-findings.ts`: trong cùng `file + line + category`, nếu ≥2
  finding cùng severity → giữ finding có evidence dài nhất (nhiều thông tin
  nhất), annotate `(+N similar)`.
- Conservative: khác line hoặc khác category thì KHÔNG gộp.

### 4.3 Findings grouping + warning budget (P5)
- Console & markdown: nhóm các warning lặp theo pattern (cùng category + message
  prefix sau normalize, vd "Direct antd import of X") thành 1 dòng
  `Direct antd import — 23 occurrences across 14 files (danh sách thu gọn)`.
- Thêm `review.maxFindingsPerFile` (default 0 = off) và section
  "Top issues by frequency" đầu report để người đọc nhìn 1 màn hình là biết
  cần làm gì.

### 4.4 `--output <path>` cho local mode (P6)
- Local mode render console như hiện tại, đồng thời khi có `--output report.md`
  → build `ReviewReport` (tái dùng `buildReport` + `formatMarkdownReport`,
  gồm cả section Commits/Resolved) và ghi file markdown sạch không ANSI.
- Đây cũng là cách hoàn tất việc local mode "hỗ trợ markdown" đúng nghĩa
  thay vì chỉ warning như patch 3.1.1.

---

## Phase 5 — Precision tiếp theo (2–3 ngày)

### 5.1 Siết confidence gate cho runtime-crash (P7)
- `runtime-crash` CRITICAL yêu cầu `confidence: high`; `medium` → WARNING
  + tag `[needs-human-review]`. `security` giữ ngưỡng hiện tại (medium được
  phép — thà báo nhầm còn hơn bỏ sót).
- Đo lại trên gems trước khi chốt default; cho config qua
  `ai.criticalConfidenceFloor`.

### 5.2 Enclosing-symbol context (nợ 3.1)
- `collectReviewInput` đính kèm cho mỗi hunk: body function/component bao quanh
  + toàn bộ import của file (lấy từ source-index khi có).
- File < 300 dòng: gửi full file. Đây là fix gốc cho mọi false positive dạng
  "không thấy guard/props" mà contextLines=8 chỉ giảm một phần.

### 5.3 Refactor finding quality gate
- Finding category `refactor` thiếu đề xuất cụ thể (không chứa động từ
  extract/move/memoize/split + tên symbol) → downgrade INFO. Ép model
  đưa actionable suggestion như rubric yêu cầu.

---

## Phase 6 — Vận hành (nợ 3.4 + theo dõi)

### 6.1 Circuit-breaker UNREVIEWED/resume
- Files skip do provider error → section **UNREVIEWED** + in sẵn lệnh chạy lại
  `--files <list>`. Status tổng phân biệt được "reviewed-clean" vs "not-reviewed".

### 6.2 Benchmark định kỳ
- Script `npm run benchmark:review`: chạy review trên fixture gems-anonymized,
  so kết quả với golden findings (đã có từ benchmark session này), in
  precision/actionability. Chạy trước mỗi release; acceptance giữ nguyên:
  critical precision ≥ 90%, actionability ≥ 90%.

### 6.3 Theo dõi provider
- deepseek-v4-pro qua gateway trả prose dài & hay tự phủ định — sau 4.1/5.1,
  nếu noise vẫn cao, thử lại openrouter/qwen (config cũ) trên cùng branch để
  so sánh chất lượng finding giữa 2 model trước khi chốt model mặc định cho team.

---

## Thứ tự đề xuất

1. **4.1 + 4.2** (nửa ngày) — loại noise rõ ràng nhất, không rủi ro.
2. **4.4** (nửa ngày) — team gems cần report file sạch để đính vào MR.
3. **4.3** (1 ngày) — đọc được 438 warnings trong 1 màn hình.
4. **5.1 → 5.3** — đo trên gems sau mỗi bước.
5. **5.2** — thay đổi lớn nhất, làm khi đã có benchmark 6.2 để đo trước/sau.

Mỗi bước theo checklist AGENTS.md §8; bump version minor khi xong Phase 4.
