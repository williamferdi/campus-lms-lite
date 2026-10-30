# REA Evidence Log — Campus LMS Lite

This file records what was investigated, with which tool, and how confident we are.
It separates **observed** behavior from **documented** behavior and from **assumptions**.

## 1. REA readiness assessment (2026-10-28)

| Check | Result | Evidence |
|---|---|---|
| REA MCP tools available in the coding session | **No** | Tool search for "rea" / "reverse engineer" in the Claude Code session returned no REA tools. |
| `rea` CLI on PATH | **No** | `where rea` returned nothing; `npm ls -g` lists no `rea-agents`. |
| Authorized Canvas reference instance | **None provided** | No URL, test account or credentials were supplied. |
| Docker / PostgreSQL on host | Not installed | `docker`, `psql` not found (affects architecture choice, see `architecture.md`). |

**Conclusion: REA did not inspect any feature during this build.** No screenshots, network
traces, HAR captures or REA Evidence records exist for this project. All reference behavior
below comes from Canvas's public API documentation and is labeled as such.

### REA prerequisites and setup (from the REA README, https://github.com/morluto/rea)

REA ("Reverse Engineer Anything") is an MIT-licensed MCP server + CLI.

1. Node.js 22.x (≥22.23.4), 24.x (≥24.22.1) or 26.12.1+ and npm. (This host has Node 24.18.0 —
   **below the 24.22.1 minimum**; upgrade Node first.)
2. Agent setup: `npx rea-agents setup` — registers the MCP server and workflow instructions with
   the agent; the agent must then be restarted.
3. Optional CLI: `npm install --global rea-agents`, then `rea --help`.
4. Website analysis additionally needs a Chrome-family browser exposing a loopback CDP endpoint
   (e.g. `chrome --remote-debugging-port=9222`) and a target ID.
5. Relevant MCP tools for web apps (per `docs/mcp-contracts.md` in the REA repo):
   `capture_browser_scenario`, `inspect_web_page`, `compare_web_captures`, `analyze_web_bundle`,
   `inspect_analysis_view` (HAR views such as `api-surface`), `analyze_javascript_application`,
   `trace_application_feature`.
6. Use is limited to software you own or are authorized to examine.

### How to collect REA evidence later (reproducible procedure)

For each priority workflow in §3:

1. Obtain an authorized Canvas instance (self-hosted `instructure/canvas-lms`, or a Canvas
   Free-for-Teacher account) and synthetic test accounts for admin/teacher/student.
2. Start Chrome with `--remote-debugging-port=9222`, sign in **manually** as the test role.
3. Ask the agent to run `capture_browser_scenario` against the loopback CDP endpoint, filtered
   to the Canvas origin, while performing the workflow.
4. Use `inspect_analysis_view` → `api-surface` to list API calls and state transitions.
5. Append findings here under the workflow heading, tagged **[REA-observed]**, with the
   Evidence record ID, and update the "Deliberate differences" column.

## 2. Evidence sources actually used

| Tag | Source | Accessed |
|---|---|---|
| [DOC-modules] | https://canvas.instructure.com/doc/api/modules.html | 2026-10-28 |
| [DOC-submissions] | https://canvas.instructure.com/doc/api/submissions.html | 2026-10-28 |
| [DOC-assignments] | https://canvas.instructure.com/doc/api/assignments.html | 2026-10-28 |
| [DOC-groups] | https://canvas.instructure.com/doc/api/assignment_groups.html | 2026-10-28 |
| [DOC-quizzes] | https://canvas.instructure.com/doc/api/quizzes.html | 2026-10-28 |
| [DOC-courses] | https://canvas.instructure.com/doc/api/courses.html | 2026-10-28 |
| [DOC-enrollments] | https://canvas.instructure.com/doc/api/enrollments.html | 2026-10-28 |
| [DOC-late] | https://canvas.instructure.com/doc/api/late_policy.html | 2026-10-28 |
| [DOC-discussions] | https://canvas.instructure.com/doc/api/discussion_topics.html | 2026-10-28 |
| [ASSUMPTION] | Product judgment, not verified against any Canvas instance | — |

No Canvas source code was copied. Canvas LMS is AGPL-3.0; this project is an independent
implementation and reuses no Canvas code, branding or assets.

## 3. Priority workflows

Each workflow lists: documented reference behavior → our requirement → acceptance test →
deliberate differences. "Observed" columns are empty because nothing was REA-observed.

### W1. Administrator creates a course and enrolls users

- **Documented** [DOC-courses]: course `workflow_state` ∈ `unpublished`, `available`,
  `completed`, `deleted`; events `offer` (publish), `claim` (unpublish — blocked once students
  have graded submissions), `conclude` (read-only), `delete`, `undelete`. Courses have
  `course_code`, term, optional start/end, image, `apply_assignment_group_weights`.
- **Documented** [DOC-enrollments]: enrollment types Student/Teacher/Ta/Designer/Observer;
  states include `active`, `invited`, `inactive`, `completed`, `deleted`; `inactive` users stay
  on the roster but cannot participate.
- **Requirement**: admin creates course (code, name, term, department, description, image);
  enrolls existing users as teacher/TA/student individually or by CSV (`email,role`); can set an
  enrollment inactive. New courses start **unpublished**.
- **Acceptance**: `server/test/api/auth-courses.test.ts` (create, enroll, CSV import, permissions),
  `e2e/admin.spec.ts`.
- **Differences**: statuses are `unpublished | published | archived` (archived ≈ concluded,
  read-only). No Designer/Observer roles. No invitation-acceptance step: enrollment is active
  immediately [ASSUMPTION — simpler for an online university with SIS-style provisioning].

### W2. Instructor publishes a course and creates modules

- **Documented** [DOC-modules]: modules have `position`, `unlock_at`,
  `require_sequential_progress`, `prerequisite_module_ids` (must have lower position, else
  ignored), `published`. Item types: File, Page, Discussion, Assignment, Quiz, SubHeader,
  ExternalUrl, ExternalTool. Completion requirements: `must_view`, `must_contribute`,
  `must_submit`, `min_score`, `must_mark_done`. Student module state: `locked`, `unlocked`,
  `started`, `completed`.
- **Requirement**: teacher creates/reorders modules and items (page, assignment, quiz,
  discussion, file, external link/video, sub-header), sets prerequisites, sequential progress,
  completion requirements, and publishes items/modules. Students never receive unpublished
  modules or items.
- **Acceptance**: `server/test/api/content.test.ts`, `server/test/unit/quiz-progress-csv.test.ts`.
- **Differences**: no ExternalTool (LTI) items. `requirement_type` is always "all".

### W3. Student accesses course content and tracks progress

- **Documented** [DOC-modules]: as W2; `prerequisite_module_ids` gate access.
- **Requirement**: student sees published modules; a locked module shows why (prerequisite or
  unlock date). Viewing an item satisfies `must_view`; `must_mark_done` has an explicit button;
  `must_submit`/`min_score`/`must_contribute` are computed from submissions/posts. Previous/next
  navigation follows module order and skips locked items. Progress % = completed requirements /
  total requirements.
- **Acceptance**: `quiz-progress-csv.test.ts`, `content.test.ts`, `e2e/student.spec.ts`.
- **Differences**: `min_score` uses **posted** scores only [ASSUMPTION — avoids leaking unposted
  grades through module progress].

### W4. Student submits an assignment

- **Documented** [DOC-assignments]: `submission_types` include `online_text_entry`,
  `online_url`, `online_upload`, `on_paper`, `none`; `allowed_extensions`; `allowed_attempts`
  (-1 unlimited); `unlock_at` < `due_at` < `lock_at`.
  [DOC-submissions]: `workflow_state` ∈ `unsubmitted`, `submitted`, `graded`,
  `pending_review`; `late`, `missing`, `excused`, `seconds_late`, `attempt`.
- **Requirement**: students submit text, URL or file(s) within the window; server enforces type,
  extension, size, attempt limit, lock date, enrollment state. Each attempt is kept as history.
  Late = submitted after `due_at`.
- **Acceptance**: `server/test/api/assignments.test.ts`, `e2e/student.spec.ts`.
- **Differences**: no media recording / annotation submissions. Attempts limit `null` = unlimited.

### W5. Instructor reviews, grades and returns the submission

- **Documented** [DOC-submissions]: grade via points, percent, letter, pass/fail; `excuse`;
  `grade_matches_current_submission`; `posted_at`; `redo_request`.
  [DOC-late]: late policy deducts N% per interval with an optional minimum-percent floor.
- **Requirement**: grader sees submissions by status, opens each, enters a score (or excuses),
  writes a comment, may "return for revision" (grants one more attempt and marks the
  submission `returned`). Late deductions applied automatically when the course late policy is
  enabled. All grade changes are audited.
- **Acceptance**: `assignments.test.ts`, `e2e/instructor.spec.ts`.
- **Differences**: late interval fixed to **day** (Canvas allows hour/day).

### W6. Student completes a quiz

- **Documented** [DOC-quizzes]: `time_limit` minutes; `allowed_attempts` (-1 unlimited);
  `scoring_policy` `keep_highest`/`keep_latest`; `hide_results` (`null`/`always`/
  `until_after_last_attempt`); `show_correct_answers`, `show_correct_answers_at`; availability
  `unlock_at`/`lock_at`/`due_at`; unpublish blocked once students have attempts.
- **Requirement**: as documented, for multiple choice, multiple select, true/false and short
  answer. Answers autosave; timer enforced **on the server** (late submissions after expiry are
  auto-submitted with saved answers). Objective questions auto-graded; short-answer is
  auto-matched against accepted answers when provided, otherwise `pending_review` until manually
  graded. Answer keys are never sent to students except as release settings permit.
- **Acceptance**: `server/test/api/quizzes-comms.test.ts`, `server/test/unit/quiz-progress-csv.test.ts`.
- **Differences**: no question banks, no access codes, no partial credit for multiple select
  beyond all-or-nothing [ASSUMPTION — documented in UI].

### W7. Instructor reviews grades and releases results

- **Documented** [DOC-assignments] `post_manually`; [DOC-submissions] `posted_at`;
  [DOC-enrollments] `current_score` vs `final_score`, `unposted_*` variants for staff.
- **Requirement**: gradebook grid (students × assignments) with inline entry, status flags,
  current/final totals, CSV export/import. Per assignment "Release grades"/"Hide grades" when
  the post policy is manual. Staff see unposted totals; students see posted only.
- **Acceptance**: `server/test/unit/grading.test.ts`, `server/test/api/assignments.test.ts` (gradebook section).

### W8. Student views grades, feedback and upcoming deadlines

- **Requirement**: Grades page lists each assignment with status, posted score, feedback and
  current/final totals; dashboard and calendar show upcoming due items; notifications are
  in-app (read/unread) and emailed only when SMTP is configured.
- **Acceptance**: `assignments.test.ts` (student cannot see unposted), `e2e/student.spec.ts`, `e2e/access.spec.ts`.

## 4. Open questions / unverified assumptions

1. Exact Canvas current/final score semantics for missing work (docs only hint that "final"
   treats ungraded as 0). We implement: current = graded only; final = ungraded counted as 0.
2. Canvas drop-lowest uses an optimizing algorithm; we drop the lowest/highest by percentage.
3. Canvas UI copy, layout and navigation order were **not** observed; our UI is original.
