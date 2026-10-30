# Campus LMS Lite

A lightweight, production-minded learning management system for an online university. It covers
the core Canvas-style workflows for administrators, instructors, teaching assistants and students.
It is an independent implementation with its own code, interface and branding (see
[licensing](#licensing)).

**What works today:** user and course administration, enrollments (individual and CSV), modules
with prerequisites and completion tracking, pages, files, assignments with text/URL/file
submissions, grading with feedback, return for revision and late policies, a weighted gradebook
with release control and CSV import/export, timed quizzes with auto- and manual grading,
discussions, announcements, a calendar, in-app notifications, and role-based dashboards.
Details: [docs/requirements.md](docs/requirements.md).

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 8, TypeScript (strict), Tailwind CSS 4, React Router 7, TanStack Query |
| Backend | Node 24, Fastify 5, Zod 4, Drizzle ORM |
| Database | PostgreSQL 16+ in production; embedded PGlite (Postgres 18 in WASM) for dev and tests |
| Tests | Vitest (unit + API integration), Playwright + axe-core (end-to-end, accessibility, mobile) |

## Documentation

- [Architecture](docs/architecture.md): design decisions and the **grade calculation rules**
- [Requirements & feature matrix](docs/requirements.md): implemented, deferred and unsupported
- [REA evidence](docs/rea-evidence.md): what was and was not investigated, and REA setup steps
- [Database model](docs/database-model.md) · [API reference](docs/api.md) · [Deployment, backups & security](docs/deployment.md)
- [UI rebuild plan](docs/ui-rebuild-plan.md) · [Design system](docs/design-system.md) · [UI reference evidence](docs/rea-ui-evidence.md) · [Screenshots](docs/screenshots/)

## User interface

The UI uses a familiar LMS layout:

- **Global rail:** a dark navigation rail on the left with Account, Dashboard, Courses, Calendar, Inbox, History and Help.
  - Account, Courses, History and Help open slide-out trays.
  - The rail collapses to icons only.
- **Course navigation:** a sidebar inside each course that can be shown or hidden, with breadcrumbs.
- **Dashboard:** course cards next to a To do / Coming up sidebar.
- **Modules:** collapsible sections.
- **Assignments:** a list you can search and show by type or by date.
- **Phones:** a navigation drawer.

Icons are [Lucide](https://lucide.dev/) (ISC). Menus, tooltips, trays and tabs use [Radix Primitives](https://www.radix-ui.com/primitives) (`radix-ui`, MIT), styled in the shadcn/ui pattern. No Canvas code, logos or assets are used.

Not built yet, because the backend has no support for them: direct messaging (the Inbox says so), Groups, and server-side page history (History is stored per device).

To refresh the screenshots in `docs/screenshots/`, start `npm run dev` with the demo seed, then run:

```bash
node --env-file=.env scripts/screenshots.mjs
```

## Prerequisites

- Node.js **22.12+** and npm 10+. No database server is needed for development.
- For production: PostgreSQL 16+ and an HTTPS reverse proxy.

## Quick start (development)

```bash
npm install
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env
npm run db:seed               # creates server/data/pglite with demo data (dev only)
npm run dev                   # API on http://localhost:3000, web app on http://localhost:5173
```

Open http://localhost:5173. The demo accounts and their shared password are printed by
`npm run db:seed`; the password is `SEED_PASSWORD` in your `.env` (change it before seeding). Accounts:

| Role | Email |
|---|---|
| Administrator | avery@campus.test |
| Instructor (BIO101) | morgan@campus.test |
| Instructor (CS150) | riya@campus.test |
| Teaching assistant (BIO101) | jordan@campus.test |
| Students | alex@, blake@, casey@, dana@, eli@, fran@campus.test |

To reset the dev database, stop the servers, delete `server/data`, and run `npm run db:seed` again.

Without SMTP configured, the app never sends email and says so. Activation and reset links are
shown to administrators instead (Admin → user → *Password reset link*).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | API (watch mode) + Vite dev server |
| `npm run build` | Production build of web (`web/dist`) and server (`server/dist`) |
| `npm start` | Run the production server (serves API + SPA on `PORT`, applies migrations) |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` |
| `npm run db:seed` | Load demo data (refuses to run on a non-empty DB or in production) |
| `npm run create-admin -- --email … --name …` | Bootstrap the first production admin (prints an activation link) |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript strict checks for server and web |
| `npm test` | Unit + API integration tests (in-memory Postgres via PGlite) |
| `npm run test:e2e` | Playwright end-to-end tests (builds the app, boots a seeded server) |
| `npm run check` | lint + typecheck + tests + build |

To change the schema, edit `server/src/db/schema.ts`, then run
`npm run db:generate --workspace server` and commit the new SQL file in `server/drizzle/`.

## Testing

- **Unit** (`server/test/unit`): grade calculation (current/final, excused, weights,
  drop rules, extra credit, rounding, late policy, grade parsing), quiz scoring and result
  visibility, module progress and locking, CSV.
- **API integration** (`server/test/api`): authentication, CSRF, rate limiting,
  activation/reset, RBAC for every role, enrollment, content sanitization, file validation and
  privacy, module locking, submissions, grading, release/hide, late policy, return for
  revision, gradebook CSV, quizzes (answer-key protection, timer, attempts, manual grading,
  regrade, release settings), discussions (require-initial-post, moderation, graded),
  delayed announcements, notifications, calendar, dashboards, seed.
- **End-to-end** (`e2e/`): the eight priority workflows (admin creates a course and enrolls;
  account activation; instructor builds content, creates an assignment, grades and releases;
  student progresses through modules, submits, takes a quiz, reviews grades and feedback),
  access-control checks from the browser, axe-core accessibility scans (WCAG 2 A/AA,
  serious/critical) of key screens, and a phone-viewport run.

### Verification (latest run, 2026-10-28, Windows 11, Node 24.18)

| Check | Result |
|---|---|
| `npm run lint` | pass (0 problems) |
| `npm run typecheck` | pass (server + web, strict) |
| `npm test` | **128 / 128** passed (7 files) |
| `npm run test:e2e` | **12 / 12** passed (11 desktop + 1 mobile) |
| `npm run build` | pass. Note: the single JS bundle is 540 kB (150 kB gzip); route-level code splitting is a future optimization. |
| Production bundle smoke test | pass (migrations, SPA, CSP headers, error envelope) |
| Docker image / PostgreSQL server | **not run** (no Docker or Postgres on the build machine) |

## Deployment

See [docs/deployment.md](docs/deployment.md): environment variables, `npm start` and Docker
Compose (PostgreSQL + app), first-admin bootstrap, **backup and restore** for the database and
file storage, and the security checklist.

## Licensing

This project was written from scratch. It contains **no code, branding, logos or assets from
Canvas LMS** (Instructure, AGPL-3.0). Canvas's public API documentation was used only as a
reference for expected LMS behavior; see [docs/rea-evidence.md](docs/rea-evidence.md).
Third-party dependencies are open-source npm packages under their own licenses (MIT, ISC,
Apache-2.0 and similar); run `npx license-checker --summary` before distributing. Choose and add
a project license before publishing.
