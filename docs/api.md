# API Reference — Campus LMS Lite

Base path: `/api/v1`. JSON in and out (file uploads use `multipart/form-data`, field `file`).
The route list below was generated from `server/src/routes/*.ts`.

## Conventions

| Topic | Behavior |
|---|---|
| Authentication | `POST /auth/login` sets an `HttpOnly; SameSite=Lax` cookie `lms_session` (and `Secure` in production). |
| CSRF | Every non-GET request made with a session must send `X-CSRF-Token` (from `/auth/login` or `/auth/me`). Missing or wrong token → `403 csrf_failed`. |
| Errors | `{ "error": { "code": string, "message": string, "details"?: [{ "path", "message" }] } }`. Codes include `unauthorized` (401), `forbidden` (403), `not_found` (404), `conflict` (409), `validation_error` (422), `file_too_large` (413), `rate_limited` (429), `internal_error` (500, no internals). |
| Validation | Zod schemas validate every body, query and path parameter. Field errors come back in `details[].path`. |
| Pagination | List endpoints marked **P** accept `page` (default 1) and `perPage` (default 25, max 100) and return `{ data, meta: { page, perPage, total, pageCount } }`. |
| Privacy | Courses you cannot access return **404**, not 403, so existence is not disclosed. Students receive only published content, posted grades and their own submissions. |
| Dates | ISO-8601 with an offset (e.g. `2026-11-03T23:59:00Z`). `null` or `""` clears an optional date. |

Role legend used below: **A** admin · **T** teacher · **TA** · **S** student · **U** any signed-in user · **pub** public.

## Auth & account

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | /auth/login | pub | `{email, password}`. Rate-limited per IP (`AUTH_RATE_LIMIT_PER_MINUTE`). |
| POST | /auth/logout | U | Deletes the server session. |
| GET | /auth/me | pub | `{user, csrfToken, emailConfigured}`; `user:null` when signed out. |
| PATCH | /auth/me | U | `name`, `bio`, `timeZone`, `emailNotifications`. |
| POST | /auth/change-password | U | Needs the current password; signs out other sessions. |
| GET | /auth/token-info?token= | pub | Whether an activation/reset token is valid. |
| POST | /auth/activate | pub | `{token, password}`. Activates the account and signs in. |
| POST | /auth/forgot-password | pub | Emails a link if SMTP is configured; otherwise says so honestly. |
| POST | /auth/reset-password | pub | `{token, password}`. Revokes all sessions. |

## Administration

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /users **P** | A | Filters: `q`, `role`, `status`. |
| POST | /users | A | `{name, email, role, password?}`. Without a password: pending user plus `activationUrl`. |
| POST | /users/import | A | `{csv}` with columns `name,email,role`. Returns per-row results and activation links. |
| GET / PATCH | /users/:id | A | PATCH `name`, `email`, `role`, `status` (`active`/`deactivated`). Admins cannot demote or deactivate themselves. |
| POST | /users/:id/activation-link · /users/:id/reset-link | A | Issues a single-use link (invalidates earlier ones). Audited. |
| GET/POST/PATCH/DELETE | /terms, /terms/:id · /departments, /departments/:id | U read, A write | Delete is refused while courses use the term or department. |
| GET | /admin/audit **P** | A | Filters: `q`, `action` prefix. |
| GET | /dashboard | U | Role sections: `admin`, `teaching`, `learning`, plus recent `announcements`. |

## Courses, people, sections

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /courses **P** | U | `scope=mine|all` (all = admin only), `q`, `status`, `termId`, `departmentId`. Students never get unpublished courses. |
| POST | /courses | A, instructor | Creates the course with a default section and assignment group. Instructors are enrolled as teacher. |
| GET | /courses/:id | enrolled/A | `{course, permissions}`. |
| PATCH | /courses/:id | T/A | Details, `applyGroupWeights`, `latePolicyEnabled`, `lateDeductionPercent`, `lateFloorPercent`. |
| POST | /courses/:id/status | T/A | `{status: unpublished|published|archived}`. Unpublish is blocked once grades are posted. Only admins can reopen archived courses. |
| POST | /courses/:id/duplicate | T/A | `{code, name, termId?}`. Copies content, not people or grades. |
| POST / DELETE | /courses/:id/image | T/A | Image upload (PNG, JPEG, GIF, WebP). |
| GET | /courses/:id/audit **P** | T/A | Course audit trail. |
| GET | /courses/:id/stats | T/TA/A | Progress, scores, missing/late counts, assignment completion. |
| GET | /courses/:id/enrollments | enrolled | Staff get email, status and activity; students get names and roles only. |
| GET | /courses/:id/enrollment-candidates?q= | T/A | Up to 10 matching users who are not yet enrolled. |
| POST | /courses/:id/enrollments | T/A | `{email|userId, role, sectionId?}`. |
| POST | /courses/:id/enrollments/import | T/A | `{csv}` with `email,role,section`. |
| PATCH / DELETE | /enrollments/:id | T/A | `role`, `status` (`active|inactive|completed`), `sectionId`. You cannot change or remove your own enrollment. |
| GET/POST, PATCH/DELETE | /courses/:id/sections, /sections/:id | read: enrolled · write: T/A | A course keeps at least one section. |

## Content

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /courses/:id/modules | enrolled | Staff get all modules. Students get published modules and items with `state`, `locked`, `completed` and overall `progress`. |
| POST | /courses/:id/modules · PATCH/DELETE /modules/:id | T/TA/A | `title`, `published`, `unlockAt`, `requireSequential`, `prerequisiteIds` (earlier modules only). |
| POST | /courses/:id/modules/reorder | T/TA/A | `{moduleIds}`. Prerequisites that would now point forward are dropped. |
| POST | /modules/:id/items · /modules/:id/items/reorder | T/TA/A | Item `type`: page, assignment, quiz, discussion, file, link, subheader. The requirement must suit the type. |
| PATCH / DELETE | /module-items/:id | T/TA/A | |
| POST | /module-items/:id/view · /module-items/:id/done | S | Records a view or mark-done. Refused while the item is locked. |
| GET | /courses/:id/module-nav?itemId=|refId= | enrolled | `{current, prev, next}` in module order. |
| GET/POST | /courses/:id/pages · GET /courses/:id/front-page | enrolled / T/TA/A | |
| GET/PATCH/DELETE | /pages/:id | enrolled / T/TA/A | Students: published and unlocked only. Markdown source is staff-only. |
| POST | /markdown/preview | U | Renders and sanitizes exactly as saved content is. |
| GET/POST | /courses/:id/files | enrolled / T/TA/A | Upload is multipart (up to 10 files). Type and magic-byte checks apply. |
| PATCH / DELETE | /files/:id | T/TA/A | Rename (extension kept), publish. |
| GET | /files/:id/download[?download=1] | authorized | The only way to read file bytes. See security rules in `architecture.md`. |

## Assignments, submissions, grading

| Method | Path | Who | Notes |
|---|---|---|---|
| GET/POST | /courses/:id/assignment-groups · PATCH/DELETE /assignment-groups/:id | enrolled / T/TA/A | `weight`, `dropLowest`, `dropHighest`. DELETE `?moveTo=`. |
| GET | /courses/:id/assignments | enrolled | Staff get counts. Students get `mySubmission` (posted grade only). |
| POST | /courses/:id/assignments | T/TA/A | `title`, `description` (Markdown), `pointsPossible`, `gradingType`, `submissionTypes`, `allowedExtensions`, `allowedAttempts`, `unlockAt/dueAt/lockAt`, `published`, `postManually`, `omitFromFinal`, `groupId`. |
| GET/PATCH/DELETE | /assignments/:id | enrolled / T/TA/A | PATCH changes only the fields sent. Unpublish is blocked after submissions. |
| POST | /assignments/:id/post-grades · /hide-grades | T/TA/A | Release or hide grades for the assignment. Audited, and students are notified. |
| POST | /assignments/:id/uploads | S | Multipart. Returns file ids for a submission. |
| POST | /assignments/:id/submit | S | `{submissionType, body?|url?|fileIds?}`. Checks window, attempts, type, ownership, module locks. |
| GET | /assignments/:id/submissions?status= | T/TA/A | All students plus a summary. |
| GET | /assignments/:id/submissions/:userId | grader or self | Attempts, files, comments (the student sees grader comments once released). |
| PUT | /assignments/:id/submissions/:userId/grade | T/TA/A | `{grade?: "8.5"|"85%"|"B+"|"complete"|null, excused?, latePolicyStatus?: late|missing|none|null, comment?}`. |
| POST | /assignments/:id/submissions/:userId/return | T/TA/A | `{comment}`. Return for revision (grants an attempt if needed). |
| POST | /assignments/:id/submissions/:userId/comments | grader or self | |
| GET | /courses/:id/gradebook | T/TA/A | Grid with cells and totals: `totals` (all grades) and `postedTotals`. |
| GET | /courses/:id/grades/:userId\|me | self (posted only) or grader | Per-assignment rows, group grades, current and final totals. |
| GET | /courses/:id/gradebook/export | T/TA/A | CSV, formula-injection safe. |
| POST | /courses/:id/gradebook/import | T/TA/A | `{csv, dryRun=true}`. Rows match by email, columns by `[assignment-id]`. |
| GET | /courses/:id/needs-grading | enrolled | Count of submissions awaiting grading (0 for students). |

## Quizzes

| Method | Path | Who | Notes |
|---|---|---|---|
| GET/POST | /courses/:id/quizzes | enrolled / T/TA/A | Graded quizzes create a linked assignment (`online_quiz`). New quizzes start unpublished. |
| GET/PATCH/DELETE | /quizzes/:id | enrolled / T/TA/A | Student view includes their attempts, `keptScore`, `startBlockReason`. Publishing needs at least one question. |
| GET | /quizzes/:id/questions | T/TA/A only | Includes answer keys. Returns 403 for students. |
| POST · PATCH/DELETE | /quizzes/:id/questions · /quiz-questions/:id | T/TA/A | `type`, `prompt`, `points`, `choices`, `correctChoiceIndexes`, `correctBoolean`, `acceptedAnswers`, `feedback`. |
| POST | /quizzes/:id/questions/reorder · /quizzes/:id/regrade | T/TA/A | Regrade keeps manual scores. |
| POST | /quizzes/:id/attempts | S | Starts an attempt, or resumes the open one. The server sets `expiresAt`. |
| GET | /quiz-attempts/:id | owner or grader | Auto-submits if expired. Keys and correctness appear only as the release settings allow. |
| PUT | /quiz-attempts/:id/answers | owner | Autosave. Returns 409 once time is up. |
| POST | /quiz-attempts/:id/submit | owner | Final answers are accepted only before expiry. |
| GET | /quizzes/:id/attempts | grader (all) / S (own) | |
| PUT | /quiz-attempts/:id/grade | T/TA/A | `{scores: {questionId: points|null}, comments}`. Syncs to the gradebook. |

## Discussions, announcements, calendar, notifications

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /courses/:id/discussions?type=discussion\|announcement | enrolled | Students see published topics whose post time has passed. |
| POST | /courses/:id/discussions | T/TA/A | `isAnnouncement`, `delayedPostAt`, `locked`, `pinned`, `threaded`, `requireInitialPost`, `graded: {pointsPossible, dueAt, groupId}`. |
| GET/PATCH/DELETE | /discussions/:id | enrolled / T/TA/A | GET returns `entries` (flat with `parentId`), `mustPostFirst`, `canReply`, `canModerate`. |
| POST | /discussions/:id/entries | enrolled | `{body, parentId?}`. Enforces locks, require-initial-post and depth. |
| PATCH / DELETE | /discussion-entries/:id | author or staff | DELETE is a soft delete. Staff removals are audited. |
| GET | /calendar?start&end[&courseId] | U | Merges course and personal events with assignment and quiz due dates. Range up to about a year. |
| POST · PATCH/DELETE | /calendar-events · /calendar-events/:id | U (personal), staff (course) | |
| GET | /notifications **P** [?unread=true] · /notifications/unread-count | U | `emailStatus`: `not_configured`, `sent`, `failed` or `skipped`. |
| POST | /notifications/:id/read `{read}` · /notifications/read-all | U | Own notifications only. |

`GET /healthz` (outside `/api/v1`) returns `{ ok: true }` for load balancers.
