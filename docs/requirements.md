# Requirements & Feature Matrix — Campus LMS Lite

Status legend: ✅ implemented and covered by automated tests · 🟡 implemented, only partly
tested or simplified · ⏳ deferred · ❌ out of scope / unsupported.

Reference behavior comes from Canvas public API documentation (see `rea-evidence.md`). No
REA-observed evidence exists for this build.

## A. Authentication & user management

| Feature | Status | Notes / tests |
|---|---|---|
| Roles: admin, instructor, TA, student | ✅ | Platform role on the user; course role (teacher/TA/student) on the enrollment. `auth-courses.test.ts` |
| Login / logout, server sessions, CSRF | ✅ | HttpOnly cookie + per-session CSRF token; login rate limit |
| Account activation (link) | ✅ | Admin-issued, single-use, 7 days. E2E `admin.spec.ts` |
| Password reset | ✅ | Email when SMTP is configured; otherwise an admin-issued link (1 h). Revokes sessions. |
| Profile & account settings | ✅ | Name, bio, time zone, email preference, change password |
| Activate / deactivate users | ✅ | Deactivation kills sessions; self-lockout prevented |
| Bulk user import (CSV) | ✅ | Per-row results and activation links |
| Course-level permissions | ✅ | `services/policy.ts`; 404 for non-members |
| SSO (SAML/OIDC), MFA | ⏳ | Not implemented |

## B. Course management

| Feature | Status | Notes |
|---|---|---|
| Create / edit courses (code, description, image, term, dates, department) | ✅ | Admins and instructors |
| Assign teachers / TAs; enroll students individually or by CSV | ✅ | |
| Publish / unpublish / archive | ✅ | Unpublish blocked after grades are released; archive is read-only |
| Duplicate course | ✅ | Copies content and files; not people or grades. Dates are not shifted (⏳ date shifting). |
| Organize by term / department | ✅ | Filters on course lists |
| Enrollment & completion statistics | ✅ | Course Progress page, admin dashboard |
| Sections | 🟡 | Create/rename/delete and assign students. Section-specific due dates are ⏳. |
| Hard delete of courses | ❌ | Archive instead (safer for academic records) |

## C. Modules & learning content

| Feature | Status | Notes |
|---|---|---|
| Modules with ordered items (page, assignment, quiz, discussion, file, link/video, sub-heading) | ✅ | Reorder by up/down buttons (no drag-and-drop) |
| Rich-text pages | ✅ | Markdown with server-side sanitization and live preview; YouTube/Vimeo embeds |
| Files (private, published state) | ✅ | Type allow-list + magic bytes + size limit |
| Prerequisites, unlock dates, sequential progress | ✅ | `progress.test`, `content.test`, E2E `student.spec.ts` |
| Completion requirements (view, mark done, submit, min score, contribute) | ✅ | `min_score` uses released scores only |
| Draft / published states | ✅ | Module, item and content levels |
| Previous / next navigation | ✅ | Module nav footer on content pages |
| Student progress tracking | ✅ | Per module, per course, dashboard |
| WYSIWYG editor | ⏳ | Markdown editor with preview instead |
| LTI / external tools | ❌ | |

## D. Assignments & submissions

| Feature | Status | Notes |
|---|---|---|
| Instructions, due/available dates, points, grading type | ✅ | points, percent, letter, complete/incomplete, not graded |
| Text, URL and file-upload submissions; on-paper | ✅ | Server-validated types, extensions, size, ownership |
| Attempts limit, availability window, late flag | ✅ | |
| Late policy (per day, floor) | ✅ | Course-level; per-submission override (late / missing / none) |
| Submissions by student and status; grading with feedback | ✅ | Grader view with filters, prev/next student |
| Return for revision | ✅ | Grants an extra attempt when needed |
| Submission history and confirmation | ✅ | Every attempt kept |
| Rubrics, annotations, peer review, group assignments | ⏳ | |
| Plagiarism detection | ❌ | |

## E. Quizzes

| Feature | Status | Notes |
|---|---|---|
| Multiple choice, multiple answers, true/false, short answer | ✅ | Multiple answers is all-or-nothing |
| Instructions, time limit, attempts, availability | ✅ | Timer enforced on the server; expired attempts auto-submit |
| Auto-grading; manual grading for short answer | ✅ | Accepted-answer matching ignores case and spacing |
| Saved answers (autosave), resume | ✅ | |
| Result release settings (hide responses, correct answers from date, manual score release) | ✅ | |
| Answer key protection | ✅ | Keys never sent to students unless release rules allow |
| Regrade after key change | ✅ | |
| Question banks, randomized question pools, essay rubrics, partial credit | ⏳ | |
| Proctoring / lockdown browser, access codes | ❌ | |

## F. Gradebook

| Feature | Status | Notes |
|---|---|---|
| Students × activities grid incl. quizzes and graded discussions | ✅ | |
| Inline grade entry, excuse with `EX` | ✅ | |
| Totals: current and final, weighted groups, drop lowest/highest | ✅ | `grading.test.ts` (rules in `architecture.md` §5) |
| Ungraded / submitted / missing / late / excused states | ✅ | |
| Withhold until released (per assignment) | ✅ | Students see only released grades and totals |
| CSV export and import (dry run + apply) | ✅ | Formula-injection safe export |
| Student grades view with feedback | ✅ | |
| Custom grading schemes, final grade override, grade history UI | ⏳ | The audit log records every change |

## G. Discussions & announcements

| Feature | Status | Notes |
|---|---|---|
| Announcements (incl. delayed posting) | ✅ | Notifies students when posted |
| Threaded / single-level discussions | ✅ | Depth limit 6 |
| Moderation: lock, pin, remove posts, edit | ✅ | Staff removals audited |
| Student posting rules (locked, post-before-viewing) | ✅ | Students cannot create topics (⏳ optional setting) |
| Graded discussions | ✅ | The first post counts as the submission |

## H. Calendar & notifications

| Feature | Status | Notes |
|---|---|---|
| Course and personal calendar, due dates, month grid + mobile agenda | ✅ | |
| Upcoming lists | ✅ | Dashboard and course home |
| In-app notifications, read/unread | ✅ | Announcements, new assignments/quizzes, submissions, grades, comments, revision requests, enrollment, replies |
| Email notifications | 🟡 | Sent only when `SMTP_URL` is set (not exercised in tests). Without it, the status is recorded as `not_configured`. |
| Deadline reminder emails / digests | ⏳ | |
| iCal feed | ⏳ | |

## I. Dashboards & reporting

| Feature | Status | Notes |
|---|---|---|
| Admin: user, course and enrollment counts, publication status, completion, audit | ✅ | All computed live |
| Instructor: courses, deadlines, grading queue, progress and score summaries | ✅ | |
| Student: courses, announcements, deadlines, to-do, recent grades, progress | ✅ | |
| Exportable reports beyond the gradebook CSV | ⏳ | |

## Acceptance criteria (from the brief)

| # | Criterion | Result |
|---|---|---|
| 1 | All roles sign in and do their tasks | ✅ API tests + E2E for admin, instructor, student. TA covered by API tests (grading, content). |
| 2 | Admins create courses and manage enrollments | ✅ |
| 3 | Instructors publish content and create assignments | ✅ |
| 4 | Students access content, submit work, take quizzes | ✅ |
| 5 | Instructors grade and release results | ✅ |
| 6 | Grade totals consistent and covered by automated tests | ✅ `grading.test.ts` (unit) + gradebook API tests |
| 7 | Students cannot see others' private submissions or unreleased grades | ✅ API tests + E2E `access.spec.ts` |
| 8 | Navigation and dashboards use real data | ✅ |
| 9 | Desktop and mobile layouts | ✅ E2E mobile project (Pixel 7) checks for no horizontal scroll on core screens |
| 10 | Forms validate and show actionable errors | ✅ Server (zod) + client field errors |
| 11 | Migrations and seed scripts work as documented | ✅ Seed tested in `seed.test.ts`; migrations run in every test |
| 12 | Tests, lint, type check and build pass | ✅ See README "Verification" |
