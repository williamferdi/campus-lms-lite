# UI Rebuild Plan: Canvas-style interface for Campus LMS Lite

Status: implemented. This file is the Stage 1 audit and plan. Results are in §6.
Reference evidence and assumptions: [rea-ui-evidence.md](rea-ui-evidence.md).
Design system: [design-system.md](design-system.md).

## 1. Audit of the existing project (2026-10-29)

| Area | Finding | Decision |
|---|---|---|
| Frontend stack | React 19, Vite 8, TypeScript strict, Tailwind CSS 4 (`@theme` tokens in `web/src/index.css`), React Router 7, TanStack Query | Keep. No framework change. |
| Backend / API | Fastify `/api/v1`, cookie session + CSRF, role-checked routes. The web app calls it through `lib/api.ts` and `lib/query.ts` (`useApi`, `useInvalidate`) | Untouched. The UI rebuild only changes `web/` and E2E selectors. |
| Icons | `lucide-react` (ISC) is already used everywhere | Keep Lucide as the only icon family. |
| UI kit | `components/ui/index.tsx`: Button (5 variants), LinkButton, IconButton, form fields with labels and errors, Card, PageHeader, Badge, Dialog (native `<dialog>`), Table, Pagination, Empty/Loading/Error states. `feedback.tsx`: toasts + confirm dialog | Reuse and extend it. Don't replace it: every feature screen depends on its API. |
| Shell | `AppShell`: a 240 px teal sidebar with text links; a mobile top bar and drawer. `CourseLayout`: course title plus a horizontal tab row | Replace it with a Canvas-style global rail, trays, course sidebar and breadcrumbs. |
| Feature screens | 18 working screens (dashboard, courses, modules, pages/files, assignments, grading, quizzes, discussions/announcements, grades/gradebook, people, progress, settings, calendar, notifications, account, admin, auth) | Keep their logic. Restyle them through shared tokens and components. Rework the dashboard, courses, modules and assignments layouts. |
| Tests | Vitest (128 API/unit), Playwright E2E (12, incl. axe-core and a phone viewport) | Keep green. Update E2E selectors where the navigation pattern changes on purpose (for example, Courses is now a tray). |

### Not in the backend (must not be faked)

- **Inbox / conversations**: there is no messaging API. The Inbox page shows the real in-app notifications. A "Messages" tab states that direct messaging is not available.
- **History**: there is no page-view API. History is a client-side list of pages this browser visited, stored in `localStorage` and labeled "on this device".
- **Help / support tickets**: there is no ticket API. The Help tray links to in-app guides and tells users to contact their administrator.
- **Groups, ePortfolios, course favorites**: not implemented. They are left out rather than mocked.

## 2. REA availability

REA tools are **not available** in this environment:

- No REA MCP tools are registered in the session.
- No `rea` CLI is on PATH.
- No `rea-agents` package is installed globally.
- No authorized Canvas reference instance or test account was provided.

As a result:

- No Canvas screen was inspected with REA.
- No reference screenshots or network traces exist.
- No pixel dimensions or colors were measured from Canvas.

The reference layout is based on Instructure's **public user guides** only (cited in `rea-ui-evidence.md`). Every visual value is a documented design choice, not a measurement. Setup steps to collect REA evidence later are in `rea-evidence.md` §1.

## 3. Target information architecture

```
┌──────┬──────────────────────────────────────────────────────────────┐
│ Rail │ [≡] BIO101 › Modules                         (course header)  │
│      ├────────────┬─────────────────────────────────────────────────┤
│ Logo │ Home       │ Page title                      [primary action] │
│ Acct │ Announce.  │ filters / search                                 │
│ Dash │ Modules ▌  │ main content                       ┌───────────┐ │
│ Crs  │ Assignm.   │                                    │ sidebar   │ │
│ Cal  │ …          │                                    │ (to do…)  │ │
│ Inbox│ Settings   │                                    └───────────┘ │
│ Hist │            │                                                  │
│ Help │            │                                                  │
│ «    │            │                                                  │
└──────┴────────────┴─────────────────────────────────────────────────┘
```

- **Global rail (≥768 px)**: a dark rail with an icon and a label under it. The collapse toggle switches it to icons only, with tooltips; the choice is remembered on the device.
  - Account, Courses, History and Help open **trays**: focus-trapped panels next to the rail.
  - Dashboard, Calendar and Inbox are **links**.
  - Admin is shown only to administrators.
- **Course navigation**: a text list on the left, with the active page marked by a left bar and bold text. Items are filtered by course permissions. The hamburger button in the course header shows or hides it.
  - Below 1024 px it is hidden by default, and the hamburger opens it as an overlay.
- **Main content**: the course header with breadcrumbs (course code › section). Each page has a title, its primary action on the right, filters, content, and optional right-side panels.
- **Mobile (<768 px)**: a top bar with a menu button, the page context and an account shortcut. The menu button opens a **drawer** with the global links and, inside a course, the course links. Content stacks in one column, and wide tables scroll inside their card.

## 4. Component plan

| Need | Implementation |
|---|---|
| Buttons | Extend the existing `Button`: variants `primary`, `secondary`, `outline`, `ghost`, `danger` (destructive), `subtle`; sizes `sm`, `md`, `lg`; `loading`; `IconButton` with a required label and a tooltip. |
| Dropdown menus | `components/ui/menu.tsx`, built on Radix `DropdownMenu` (keyboard, typeahead, focus return). |
| Tooltips | `components/ui/tooltip.tsx`, built on Radix `Tooltip`. Used for the collapsed rail and icon-only buttons. |
| Trays / drawers | `components/ui/sheet.tsx`, built on Radix `Dialog` (focus trap, Esc, focus return, labelled). |
| Tabs | `components/ui/tabs.tsx`, built on Radix `Tabs` (arrow-key navigation). |
| Accordion | Module sections use a disclosure button with `aria-expanded` (module headers hold their own action buttons, which Radix Accordion triggers cannot contain). |
| Dialogs, toasts, confirm | Keep the existing native-`<dialog>` `Dialog` and `FeedbackProvider`. They already handle focus, labels and Esc. |
| Tables, badges, cards, forms | Keep the existing components and restyle them through tokens. |

New dependency: `radix-ui@1.4.3` (MIT), the unified Radix Primitives package. shadcn/ui is used as a **pattern**, not through its CLI: components are written in this repo with the shadcn structure (Radix primitive + Tailwind classes). This avoids adding `tailwind-merge`, `cva` and a second token system next to the existing kit.

## 5. Stages

1. Audit and plan (this file).
2. Design system: tokens in `index.css`, button/menu/tooltip/sheet/tabs, `docs/design-system.md`.
3. Shell: `GlobalNav`, trays, mobile drawer, `CourseLayout` with sidebar and breadcrumbs, recent-history tracking.
4. Student screens: dashboard (course cards + To Do sidebar), courses (cards/list toggle, filters), course home, modules (collapsible), assignments (search, group and date views), grades, calendar, inbox, account.
5. Instructor screens: existing management screens inside the new shell; instructor dashboard (To Grade, quick create), module publish/reorder, assignment controls, grading, gradebook.
6. Visual refinement at 1440×900, 1280×800, 768×1024 and 390×844.
7. Verification: lint, typecheck, unit/API tests, build, E2E (incl. axe) and screenshots (`docs/screenshots/`).

## 6. Results

See the "UI rebuild" section in `README.md` and `docs/rea-ui-evidence.md` §4 for what was verified, what is incomplete, and any open issues.
