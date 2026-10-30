# Design System — Campus LMS Lite

The design system lives in code:

- Tokens are in `web/src/index.css` (`@theme`).
- Components are in `web/src/components/ui/`.
- The shell is in `web/src/components/layout/`.

This page lists what exists and when to use it. Colours and sizes are design choices for a familiar LMS layout (dark rail, white content, one blue accent). None were measured from Canvas; see [rea-ui-evidence.md](rea-ui-evidence.md).

## 1. Tokens

Use tokens through Tailwind utilities, for example `bg-rail`, `text-brand-700`, `border-line`, `rounded-panel`.

| Token | Value | Use |
|---|---|---|
| `brand-50 … brand-900` | `#eef5fb` … `#123c60` | Accent. Links and active text use `brand-700` (7.0:1 on white). Primary buttons use `bg-brand-700`. |
| `rail` / `rail-hover` | `#26323d` / `#33424f` | Global navigation rail and auth screens |
| `rail-text` | `#d5dde4` | Rail labels (9.5:1 on `rail`) |
| `rail-active` / `rail-active-text` | white / `brand-700` | Active rail item (7.0:1) |
| `canvas` | `#f5f6f8` | Page background |
| `surface` | `#ffffff` | Cards and panels |
| `line` | `#dfe3e8` | Borders and dividers |
| `accent-400` | `#fbbf24` | Unread count on the rail only |
| `radius-control` / `radius-panel` | 6 px / 8 px | Inputs and buttons / cards, dialogs and menus |
| Course colours | 8 hues in `lib/ui-prefs.ts` | Course card headers and dots; each is ≥ 6.8:1 with white text |

### Text colour rules

- Body text is `slate-900` or `slate-800`.
- Secondary text is `slate-600` when it sits on `canvas` or on any grey surface. `slate-500` is allowed **only on white** (4.76:1), and axe enforces this in E2E.
- Never use colour alone for status. Badges carry words ("Missing", "Submitted"). Completion icons have `role="img"` and a label.

### Type

| Use | Classes |
|---|---|
| Course name (course pages) | `text-xl font-semibold` |
| Page title (`PageHeader`) | `text-2xl font-semibold` |
| Section / card title | `text-base` or `text-lg font-semibold` |
| Body | `text-sm` (14 px); rich content uses `leading-relaxed` |
| Meta | `text-xs` (12 px) |

### Motion

- Trays slide in over 160 ms and menus fade in.
- `prefers-reduced-motion: reduce` turns all animations and transitions off (`index.css`).

## 2. Icons

- **Lucide React** (`lucide-react`, ISC) is the only icon family. Never use emoji as icons.
- Sizes: `size-4` in buttons and menus, `size-5` in list rows, `size-6` in the rail and mobile bar.
- Decorative icons get `aria-hidden`. An icon that carries meaning on its own gets `role="img"` and `aria-label`.

| Concept | Icon |
|---|---|
| Dashboard | `LayoutDashboard` |
| Courses | `BookOpen` |
| Calendar | `CalendarDays` |
| Inbox | `Inbox` |
| History | `Clock3` |
| Help | `CircleHelp` |
| Admin | `Shield` |
| Assignment | `NotebookPen` |
| Quiz | `FileQuestion` |
| Discussion | `MessagesSquare` |
| Page | `FileText` |
| File | `File` / `FolderOpen` |
| Link | `Link2` |
| Announcement | `Megaphone` |
| Locked | `Lock` |
| Complete | `CheckCircle2` |
| More actions | `EllipsisVertical` |
| Expand / collapse | `ChevronRight` / `ChevronDown` |

## 3. Buttons

All buttons are in `components/ui/index.tsx`.

| Variant | Use | Example |
|---|---|---|
| `primary` | The single main action on a page or dialog | Save assignment, Submit assignment, + Module |
| `secondary` | Alternative actions next to a primary | Cancel, Export CSV, Add group |
| `outline` | Lower-emphasis action that should still read as a button | Optional step in a form |
| `ghost` | Toolbars and in-list actions | Add item, Mark read |
| `danger` | Destructive. Always behind `useFeedback().confirm({ danger: true })` | Delete module |
| `subtle` | Tinted helper action | — |

- **Sizes:** `sm` is 32 px, `md` is 40 px (the default), `lg` is 48 px. On phones, give the primary action `md` or `lg`.
- **`loading`:** shows a spinner, disables the button and sets `aria-busy`. Use it on every async submit.
- **`IconButton`:** `label` is required. It is both the accessible name and the tooltip (Radix Tooltip, shown on hover and keyboard focus).
- **`LinkButton`:** the same styles on a router `Link`. Use it when the action navigates.

## 4. Components

| Component | File | Notes |
|---|---|---|
| `TextField`, `TextAreaField`, `SelectField`, `Checkbox` | `ui/index.tsx` | Visible label, `*` for required, hint/error linked by `aria-describedby`, error has `role="alert"` |
| `SearchInput`, `Select` | `ui/index.tsx` | Filters; always pass `aria-label` |
| `Card`, `CardHeader`, `PageHeader` | `ui/index.tsx` | `PageHeader` = title, description and actions; one per page |
| `Badge` | `ui/index.tsx` | Tones: gray, green, amber, red, blue, brand, violet |
| `Table`, `Pagination` | `ui/index.tsx` | Tables scroll inside their card on narrow screens; the page itself never scrolls sideways |
| `Dialog` | `ui/index.tsx` | Native `<dialog>`: focus trap, Esc, labelled title, footer for actions |
| Toasts and `confirm()` | `ui/feedback.tsx` | `aria-live` status for success, `role="alert"` for errors |
| `Menu`, `MenuItem`, `MenuLinkItem` | `ui/menu.tsx` | Radix DropdownMenu: arrow keys, typeahead, focus returns to the trigger |
| `Tooltip` | `ui/tooltip.tsx` | Radix Tooltip; one provider in `main.tsx` |
| `Sheet` | `ui/sheet.tsx` | Radix Dialog as a side panel: trays, mobile drawer and course nav on tablets |
| `Tabs` | `ui/tabs.tsx` | Radix Tabs (Inbox) |
| `LoadingState`, `ErrorState`, `EmptyState`, `Loadable` | `ui/index.tsx` | Every query renders all three states; errors offer Try again |

## 5. Layout and navigation

| Area | Behaviour |
|---|---|
| Global rail (`AppShell.tsx`) | ≥ 768 px: fixed dark rail, 84 px with labels or 56 px collapsed (icons with tooltips). The toggle is at the bottom and is remembered per device. Account, Courses, History and Help open trays; Dashboard, Calendar and Inbox are links; Admin is for admins only. |
| Trays (`Trays.tsx`) | Modal side panels beside the rail. Esc or the backdrop closes them, and focus returns to the rail button. |
| Course navigation (`CourseLayout.tsx`) | ≥ 1024 px: a left text list with the active page marked by a dark left bar and bold text; the hamburger hides or shows it (remembered). 768–1023 px: the hamburger opens it as a sheet. Links are filtered by course permissions (Gradebook vs Grades, Progress and Settings for staff). |
| Breadcrumbs | `Course code › Section` in the course header bar. The current page has `aria-current="page"`. |
| Mobile (< 768 px) | Top bar with menu, page context, Inbox and Account. The menu drawer holds the global links and, inside a course, the course links. Content is one column. Touch targets are ≥ 44 px. |
| Page titles | `document.title` follows the page's last `<h1>` ("Assignments · Campus LMS Lite"). |

## 6. Accessibility checklist (WCAG 2.2 AA target)

- [x] Skip link, landmarks (`nav` Main / Course / Breadcrumb, `main`, `aside`) and one `PageHeader` per page.
- [x] All controls are keyboard-reachable. Trays, menus and dialogs trap focus, close on Esc and return focus.
- [x] Focus ring: 2 px `brand-600` outline with offset on every focusable element.
- [x] Icon-only controls have accessible names. Unread counts are spoken ("Inbox, 8 unread").
- [x] Contrast is checked for tokens (above) and by axe (`e2e/access.spec.ts`: login, dashboard, modules, assignments, Courses tray, Inbox, gradebook).
- [x] Reduced motion is respected.
- [ ] Not yet audited with a screen reader (NVDA or VoiceOver). Automated checks don't replace that.
