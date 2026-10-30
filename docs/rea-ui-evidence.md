# UI Reference Evidence and Assumptions — Canvas-style rebuild

Companion to [rea-evidence.md](rea-evidence.md), which covers behavior and grading. This file covers **layout, navigation and interaction**. It uses three labels:

- **[REA-observed]**: seen through REA on an authorized instance. **There are none.**
- **[DOC]**: stated in Instructure's public user guides. These are paraphrased, not copied.
- **[ASSUMPTION]**: a design choice made without verification.

## 1. REA status (2026-10-29)

| Check | Result |
|---|---|
| REA MCP tools in this session | Not available (none registered) |
| `rea` CLI / `rea-agents` package | Not installed (`where rea` is empty; `npm ls -g` has no `rea-agents`) |
| Authorized Canvas instance or test account | None provided |
| Reference screenshots / traces / HAR | **None captured.** No screenshot in this repo shows Canvas. |

So **REA did not inspect any screen**, and no pixel dimensions, colours or spacing were measured from Canvas. Values in `design-system.md` are original choices. To collect REA evidence later, follow `rea-evidence.md` §1 ("How to collect REA evidence later"). Record findings here as [REA-observed] with the Evidence record ID, then revisit the tokens.

## 2. Sources used

| Tag | Source (accessed 2026-10-29) |
|---|---|
| [DOC-globalnav] | Instructure Community, Global Navigation Menu guide and video: https://community.canvaslms.com/t5/Canvas-Video-Shorts/Video-How-do-I-use-the-Global-Navigation-Menu/ta-p/650977 |
| [DOC-dashboard] | Instructure Community, How do I use the Dashboard as a student?: https://community.canvaslms.com/docs/DOC-10587-4212710330 |
| [DOC-todo] | Instructure Community, To Do list and sidebar in the Dashboard: https://community.instructure.com/en/kb/articles/662818-how-do-i-use-the-to-do-list-and-sidebar-in-the-dashboard-as-a-student |
| [DOC-coursenav] | Instructure Community, Course Navigation Menu as a student: https://community.instructure.com/en/kb/articles/664370-how-do-i-use-the-course-navigation-menu-as-a-student |

These guides were read through a web search summary, not opened in a browser session. They describe Canvas in general, and an institution can change its menu.

## 3. Screen-by-screen

| # | Screen | Reference (what the docs say) | What we built | Status |
|---|---|---|---|---|
| 1 | Login | — | A centered card on the dark rail colour; email, password, forgot-password link; inline error | [ASSUMPTION] |
| 2 | Dashboard | [DOC-dashboard] Card, List and Recent Activity views, switched from an options menu; cards represent courses. [DOC-todo] A sidebar with a To Do list and upcoming items next to Card view. | Card view (course colour header, name, code, term, shortcut icons) and List view (14-day agenda) from a **Dashboard options** menu. Sidebar: To do / To grade, Coming up, Recent feedback, Recent submissions. Recent Activity view and personal To Do items are **not** built. | [DOC] structure; visuals [ASSUMPTION] |
| 3 | Global navigation | [DOC-globalnav] A left column of icons on every page. Account opens a tray (settings, notifications, files, log out). Courses opens a list with an "All Courses" link. History shows recently viewed course pages (about 3 weeks). Help opens help options. Inbox opens messaging with a count. The menu can be collapsed and is collapsed on tablets. | Rail with Account, Admin (admins), Dashboard, Courses, Calendar, Inbox, History and Help. Account, Courses, History and Help open trays. Collapse toggle. Groups and personal files are **not** built (no backend). History is device-local, not server-side. | [DOC] items and trays; visuals [ASSUMPTION] |
| 4 | Courses list and cards | [DOC-globalnav] "All Courses" link in the Courses tray | All courses page with List view (table) and Card view, search, and status/term/scope filters | [DOC] entry point; page [ASSUMPTION] |
| 5 | Course home | — | Front page or description, latest announcements, progress, Coming up, instructors | [ASSUMPTION] |
| 6 | Course navigation | [DOC-coursenav] A set of links on the left of a course, visible by default, which the user can collapse | Left text list, active item marked, hamburger toggle (remembered), sheet on tablets, drawer on phones, filtered by permissions | [DOC] placement/collapse; visuals [ASSUMPTION] |
| 7 | Modules | `rea-evidence.md` W2/W3 [DOC-modules] (API behavior only) | Collapsible module sections with Collapse/Expand all, type icons, requirement text, completion icons, lock reasons; staff publish, reorder, edit and delete controls | Behavior [DOC]; layout [ASSUMPTION] |
| 8 | Assignments | W4 [DOC-assignments] | Groups with weights and drop rules, search, Show by type / date, status badges, staff to-grade counts | Behavior [DOC]; layout [ASSUMPTION] |
| 9 | Submission | W4 | Unchanged screens inside the new shell | [ASSUMPTION] |
| 10 | Discussions / announcements | [DOC-discussions] in `rea-evidence.md` | Unchanged screens inside the new shell | [ASSUMPTION] |
| 11 | Grades / gradebook | W7/W8 | Unchanged screens; the gradebook table scrolls inside its card on phones | [ASSUMPTION] |
| 12 | Calendar | [DOC-todo] mentions upcoming items | Unchanged month/list calendar | [ASSUMPTION] |
| 13 | Inbox / notifications / help | [DOC-globalnav] Inbox = messaging | Inbox shows **notifications** (live). The Messages tab states that messaging is not available. Help tray gives role-specific answers. | Deliberate difference |
| 14 | Account / profile | [DOC-globalnav] account tray | Account tray plus the existing profile/password page | [DOC] tray; page [ASSUMPTION] |
| 15 | Instructor management | — | Existing settings, people, gradebook and grading screens in the new shell; dashboard quick actions (new assignment, module, announcement, gradebook) | [ASSUMPTION] |
| — | Syllabus | — | New page: course description plus a dated summary of graded work from the existing assignments API | [ASSUMPTION] |

## 4. Verification of our implementation (not of Canvas)

| Check | Result |
|---|---|
| E2E (Playwright) on the rebuilt UI | 12/12 pass, including the phone viewport |
| axe-core WCAG 2 A/AA, serious and critical | No violations on login, student dashboard, modules, assignments, Courses tray, Inbox and gradebook |
| Screenshots | `docs/screenshots/`: 12 screens × 4 viewports (1440×900, 1280×800, 768×1024, 390×844), captured with `scripts/screenshots.mjs` from the demo seed. They show **our** app only. |
| Comparison with reference screenshots | **Not possible.** No reference screenshots exist (see §1). |

## 5. Open items

- Run REA against an authorized Canvas instance, then replace [ASSUMPTION] rows with observations.
- Recent Activity dashboard view, personal To Do items, Groups, ePortfolios and conversations (messaging) need backend work first.
- History is per device. A server-side page-view log would make it follow the user.
