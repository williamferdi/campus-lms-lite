# Architecture — Campus LMS Lite

## 1. Context and constraints

- Greenfield: the project directory was empty (no existing backend, Frappe, or deployment config).
- Host has Node 24 + npm; **no Docker and no PostgreSQL**. The app must still be runnable and
  testable here, and deployable to a real PostgreSQL in production.
- The brief suggests "NestJS + PostgreSQL + Prisma unless repository constraints justify a better
  choice". We deliberately chose **Fastify + Drizzle ORM + PostgreSQL** because:
  - Drizzle runs the **same SQL migrations** against embedded **PGlite** (PostgreSQL compiled to
    WASM, used for dev and tests on hosts without Postgres) and against real PostgreSQL via
    `node-postgres` in production. No second database dialect, no SQLite divergence.
  - Fastify gives schema-validated, low-overhead HTTP with `inject()` for fast integration tests.
  - Fewer framework layers than NestJS for a small team to maintain.

## 2. System overview

```
 Browser (React 19 SPA)
   │  fetch /api/v1/*  (session cookie + X-CSRF-Token)
   ▼
 Fastify server (Node 24, TypeScript)
   ├─ plugins: helmet, cookie, rate-limit, multipart, static (serves web/dist in prod)
   ├─ auth: session cookie → req.user ; CSRF check on unsafe methods
   ├─ routes/*        HTTP layer: zod validation → policy check → queries/services → JSON
   ├─ services/*      shared rules: authorization (policy.ts), grading, progress, quizzes, audit
   ├─ domain/*        pure, unit-tested logic: grading, late policy, quiz scoring,
   │                   module progress, CSV
   ├─ storage/        private file store (local disk; S3-compatible adapter interface)
   ├─ mail/           SMTP mailer or explicit "not configured" no-op
   └─ db/             Drizzle schema + migrations
   ▼
 PostgreSQL 16+  (production)   |   PGlite (dev/test, file or in-memory)
```

One backend, one database, one source of truth for users, courses, enrollments and grades.

## 3. Repository layout

```
/server            Fastify API (TypeScript, ESM)
  src/db           schema.ts, client.ts, migrate.ts, seed.ts
  src/domain       pure logic (grading.ts, progress.ts, quiz.ts, late.ts, csv.ts)
  src/services     policy.ts (authorization), grading.ts, progress.ts, quizzes.ts,
                   duplicate.ts, audit.ts, notify.ts, mail.ts, storage.ts, uploads.ts
  src/routes       one file per resource
  drizzle/         generated SQL migrations (committed)
  test/            unit + API integration tests (Vitest, PGlite in-memory)
/web               React 19 + Vite + TypeScript (strict) + Tailwind CSS v4
  src/components   UI kit (Button, Field, Dialog, Table, EmptyState, …)
  src/features     feature screens grouped by domain
  src/lib          api client, auth context, formatting
/e2e               Playwright end-to-end tests for priority workflows
/docs              architecture, requirements, evidence, data model, API, deployment
```

## 4. Key decisions

| Concern | Decision |
|---|---|
| Auth | Server-side sessions in `auth_sessions` (token hash stored, random 256-bit token in an `HttpOnly; SameSite=Lax; Secure(prod)` cookie). Passwords hashed with Node `crypto.scrypt` (N=2^15, r=8, p=1, 16-byte salt). Login rate-limited. |
| CSRF | Per-session CSRF token returned by `/auth/me`; required in `X-CSRF-Token` for all non-GET requests. |
| Authorization | Central `services/policy.ts`: `courseAccess()` resolves the caller's course role (`admin`/`teacher`/`ta`/`student`; non-members get 404) and exposes `isStaff`, `canManage`, `canEditContent`, `canGrade`, `readOnly`. Every route handler calls it (or `requireAdmin`) before touching course data; shared rules (grading, progress, quiz sync) live in `services/`. |
| Roles | Platform role on user: `admin`, `instructor`, `student`. Course role on enrollment: `teacher`, `ta`, `student`. TA = course-level role. |
| Validation | Zod schemas on every body/query; consistent error envelope `{ error: { code, message, details? } }`. |
| Rich text | Authors write Markdown; server renders with `marked` and sanitizes with `sanitize-html` (allow-list, iframes only from YouTube/Vimeo). Stored HTML is always sanitized → safe to render. |
| Files | Stored outside the web root under `FILE_STORAGE_DIR`, keyed by random UUID. Downloaded only through `/api/v1/files/:id/download` after a permission check. Extension allow-list + size limit + magic-byte sniff for common types. |
| Grades | All calculations in `domain/grading.ts` (pure, unit-tested). See §5. |
| Notifications | Rows in `notifications`; email only when `SMTP_URL` is set, otherwise `email_status = 'not_configured'` — never claims an email was sent. |
| Audit | `audit_events` for user admin, enrollment, course status, grading, grade posting, quiz regrade. |
| Frontend state | TanStack Query for server state; React Router for routes; no global store. |

## 5. Grade calculation rules (authoritative)

Implemented in `server/src/domain/grading.ts`; tests in `server/test/unit/grading.test.ts`.

1. Countable assignment: published, `grading_type != 'not_graded'`, not `omit_from_final`.
2. **Excused** submissions are removed from numerator and denominator.
3. **Current score**: only graded (scored) submissions count. Ungraded/missing are ignored.
4. **Final score**: ungraded and missing submissions count as **0**.
5. Student-facing totals use only **posted** grades (`posted_at` set). Staff can see both
   posted-only and all-grades ("unposted") totals.
6. Late policy (course-level, optional): deduct `late_deduction_percent` of points possible per
   started day late, never below `late_floor_percent` of points possible. Applied when the
   grade is entered; stored as `entered_score`, `points_deducted`, `score`.
7. Assignment groups: per student, drop `drop_lowest` / `drop_highest` scored items by
   percentage (never dropping below 1 remaining).
8. Weighting: if the course uses weights, total = Σ(weightᵍ × pctᵍ) / Σ(weightᵍ of groups with
   any possible points). Otherwise total = Σ earned / Σ possible.
9. Zero-point assignments add earned points as extra credit. Scores above points possible are
   allowed.
10. Rounding: stored scores keep 2 decimals; percentages are computed at full precision and
    rounded half-up to 2 decimals only for display/letter lookup.
11. Letter grade from the course scheme (default A ≥ 93, A- ≥ 90, B+ ≥ 87, … F < 60).

## 6. Security summary

See `docs/deployment.md` §Security for operations. Highlights: server-side authorization for
every read/write, answer keys stripped from student payloads, unposted grades and private
submissions filtered server-side, helmet CSP, no stack traces in responses
(`NODE_ENV=production`), secrets only from environment variables.
