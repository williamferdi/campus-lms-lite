# Database Model — Campus LMS Lite

PostgreSQL. The schema source of truth is `server/src/db/schema.ts` (Drizzle). Migrations are
generated SQL in `server/drizzle/` and are applied automatically on server start, or with
`npm run db:migrate`. All primary keys are UUIDs (`gen_random_uuid()`). All timestamps are
`timestamptz`. Scores are `numeric(10,2)`.

## Entity overview

```
organizations ─┬─ users ─┬─ auth_sessions
               │         ├─ auth_tokens (activation / password_reset)
               │         └─ notifications
               ├─ terms
               ├─ departments
               └─ courses ─┬─ sections ── enrollments (user × course, role, status)
                           ├─ files (course files, submission files, course images)
                           ├─ pages
                           ├─ modules ─┬─ module_prerequisites (module → earlier module)
                           │           └─ module_items ── item_completions (user × item)
                           ├─ assignment_groups ── assignments ─┬─ submissions ─┬─ submission_attempts
                           │                                    │                └─ submission_comments
                           ├─ quizzes ─┬─ quiz_questions        │
                           │           └─ quiz_attempts         │ (quiz.assignment_id → assignments)
                           ├─ discussion_topics ── discussion_entries (self-referencing parent_id)
                           └─ calendar_events
audit_events (actor, action, entity, course, metadata jsonb)
```

## Tables

| Table | Purpose | Key columns and constraints |
|---|---|---|
| organizations | Tenant (institution) | `slug` unique |
| users | People | `email` unique case-insensitive (`lower(email)` index); `role` admin/instructor/student; `status` pending/active/deactivated; `password_hash` (scrypt) nullable until activation |
| auth_sessions | Server-side sessions | `id` = SHA-256 of the cookie token (raw token never stored); `csrf_token`; `expires_at`; cascade on user delete |
| auth_tokens | Activation and reset links | `token_hash` unique (SHA-256); `kind`; `expires_at`; `used_at` (single use) |
| terms / departments | Academic structure | belong to organization; delete refused while courses reference them |
| courses | Course shell | `code`, `name`, `status` unpublished/published/archived, `term_id`/`department_id` (SET NULL), `apply_group_weights`, late policy (`late_policy_enabled`, `late_deduction_percent`, `late_floor_percent`), `image_file_id` |
| sections | Course sections | at least one per course (enforced in the API) |
| enrollments | User × course membership | unique (course_id, user_id); `role` teacher/ta/student; `status` active/inactive/completed; `section_id` SET NULL; `last_activity_at` |
| files | Private stored files | `purpose` course/submission/course_image; `storage_key` unique (random UUID, never user-controlled); `sha256`; `published` (course files) |
| pages | Rich content | `body_md` (author source) + `body_html` (sanitized render); `is_front_page` (one per course, enforced in a transaction) |
| modules | Ordered learning path | `position`, `published`, `unlock_at`, `require_sequential` |
| module_prerequisites | Module gating | PK (module_id, prerequisite_id); prerequisite must have a lower position (validated; pruned on reorder) |
| module_items | Items in modules | `type`, `ref_id` (page/assignment/quiz/discussion/file id), `url` (links), `requirement` (none/must_view/must_mark_done/must_submit/min_score/must_contribute), `min_score`, `published`, `indent` |
| item_completions | Student view and mark-done facts | PK (module_item_id, user_id); `viewed_at`, `marked_done_at`. Submit, score and contribute requirements are derived from submissions, attempts and posts. |
| assignment_groups | Grading categories | `weight`, `drop_lowest`, `drop_highest` |
| assignments | Gradable work | `points_possible`, `grading_type`, `submission_types text[]`, `allowed_extensions text[]`, `allowed_attempts` (null = unlimited), `unlock_at/due_at/lock_at`, `published`, `post_manually`, `omit_from_final` |
| submissions | One row per student per assignment | unique (assignment_id, user_id); `status` unsubmitted/submitted/pending_review/graded/returned; `attempt`, `extra_attempts`; `entered_score`, `points_deducted`, `score`, `grade`; `excused`; `late_policy_status` override; `posted_at` (grade release); `graded_attempt` |
| submission_attempts | Immutable history | unique (submission_id, attempt); body, URL or file ids; `late` |
| submission_comments | Feedback thread | `from_grader` (hidden from the student until released) |
| quizzes | Quiz settings | `assignment_id` (graded quizzes; SET NULL), time limit, attempts, scoring policy, result-visibility settings, availability dates |
| quiz_questions | Questions | `type`, `prompt_md/html`, `points`, `choices jsonb`, `answer_key jsonb` (never sent to students unless release rules allow) |
| quiz_attempts | Attempts | unique (quiz_id, user_id, attempt_number); `answers jsonb`; `results jsonb` ({auto, manual, comment} per question); `expires_at` (server-enforced deadline); `status` in_progress/pending_review/graded |
| discussion_topics | Discussions and announcements | `is_announcement`, `published`, `posted_at`, `delayed_post_at`, `locked`, `pinned`, `threaded`, `require_initial_post`, `assignment_id` (graded) |
| discussion_entries | Replies | `parent_id` self-FK cascade; soft delete via `deleted_at`, `deleted_by_id` |
| calendar_events | Events | either `course_id` (course event) or `user_id` (personal) |
| notifications | In-app inbox | `read_at`; `email_status` not_configured/sent/failed/skipped |
| audit_events | Accountability trail | `actor_id` (SET NULL), `action`, `entity_type/id`, `course_id`, `metadata jsonb`, `ip` |

## Deletion behavior

- Deleting a **course** cascades to all its content, enrollments and submissions. The API offers
  **archive** instead; it has no hard-delete endpoint.
- **Users** are never hard-deleted by the API. Deactivation removes sessions and keeps academic
  records.
- **Removing an enrollment** keeps the student's submissions and grades. They reappear if the
  student is re-enrolled.
- Deleting **pages, assignments, quizzes, discussions or files** removes the module items that
  point at them. Deleting an assignment cascades to its submissions; the UI warns about this.
- Discussion entries are soft-deleted to keep thread structure.
- Foreign keys to users on authored content (`author_id`, `grader_id`, …) use `SET NULL`, so
  history survives.

## Indexes

Lookup indexes cover every foreign key used in queries, plus: `courses(status)`,
`assignments(due_at)`, `submissions(status)`, `notifications(user_id, created_at)`,
`audit_events(created_at)` and `calendar_events(course_id|user_id, start_at)`. Unique indexes
enforce one enrollment per user per course, one submission per student per assignment, and
unique attempt numbers.

## Known limitations

- `courses.image_file_id` has no FK (it would create a circular FK with `files.course_id`). It is
  cleared through the API.
- Module progress is computed on read. Courses with thousands of students would benefit from a
  cached progress table; that is not needed at the current scale.
