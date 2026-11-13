# ServiceHub style refresh

The existing alert-first dashboard is the visual reference. This refresh keeps
the original blue/neutral branding, system fonts, light/dark themes and navigation.
It introduces no external fonts, dependencies, new polling, route changes,
permissions changes or business-data migrations.

## Screen and role inventory

“Shared” below means that the screen inherits the refreshed card, button, badge,
input, textarea, tab or dialog primitives, rather than having its functionality
rewritten. This is intentional for dense administration and working conversations.

| Route / surface | Roles | Refresh applied | Verification |
| --- | --- | --- | --- |
| `/` | All signed-in roles | Preserved approved dashboard; removed incident Get help; acknowledged-issue guidance; conditional latest-update destination | Dashboard render regressions, loading/error/stale/priority cases |
| `/alerts` | All signed-in roles | Compact section headers, coherent panels and rows, readable long titles, calmer status dots, shared page header | Real-page query failure/retry regression |
| `/alerts/:id` | All signed-in roles | Matching headings, panel headers and spacing; explicit latest-update deep link; honest update failures | Timestamp selection, deferred data, ordinary/deep-linked visits, reduced motion, deletion/refresh, error-state regressions |
| `/services` | All signed-in roles | Compact headers/rows, readable service names, static status dots, shared badges | Typecheck/build and source inspection |
| `/services/:id` | All signed-in roles | Scoped page/panel rhythm and typography; existing uptime and tabs preserved | Typecheck/build and source inspection |
| `/service-updates` | All signed-in roles | Matching page/section headers and shared dialogs | Highlight navigation and long-editor dialog regressions |
| `/news`, `/news/:id` | All signed-in roles | Scoped page/panel styling, section headings, shared controls | Dashboard news links/unread regressions; typecheck/build |
| `/promotions` | All signed-in roles | Scoped page typography and shared cards/controls | Typecheck/build and source inspection |
| `/tickets` | Customers and authorized staff | Matching page heading, cards, pills and dialogs | Shared controls and composer regressions; typecheck/build |
| `/tickets/:id` | Ticket participants / authorized staff | Conversation surface and shared controls only; no new page padding in constrained chat | Composer, dialog/keyboard and control-override regressions; existing handlers unchanged |
| `/whmcs-tickets/:id` | Authorized linked users / staff | Scoped page and shared controls | Typecheck/build; billing/backend behavior unchanged |
| `/messages`, `/messages/:id` | Conversation participants / authorized staff | Matching list heading and thread surface; existing bounded composer preserved | Shared controls/composer regressions; thread handlers unchanged |
| `/community` | Authorized signed-in users | Matching conversation surface and shared controls; compact chat heading preserved | Typecheck/build; existing behavior unchanged |
| `/downloads` | All signed-in roles | Scoped page/section headings and shared controls | Typecheck/build; download targeting unchanged |
| `/knowledge`, `/knowledge/:slug` | Authorized signed-in users | Scoped list/article shell; article-body heading styles not globally replaced | Typecheck/build and source inspection |
| `/my-services` including store/order surfaces | Linked users and eligible staff | Matching page heading, cards, badges and dialogs | Typecheck/build; order and provisioning behavior unchanged |
| `/billing` | Authorized linked users / staff | Matching heading and shared billing controls/cards | Typecheck/build; money-writing behavior unchanged |
| `/report-request` | Authorized signed-in users | Scoped page and shared form/dialog styling | Typecheck/build |
| `/settings` | Signed-in users, existing role-specific options | Matching page, smaller card headings, compact controls | Shared form customization regressions; typecheck/build |
| `/whats-new` | Signed-in users | Scoped page/panel headings and shared controls | Typecheck/build |
| `/admin` and its existing query-string sections | Authorized staff; admin/master restrictions preserved | Matching shell, grouped-menu section headers, cards and dialogs; unrestricted workspace width; table/filter/sort/pagination logic unchanged | Admin overview/changelog render regressions; shared dense-control overrides; typecheck/build |
| Sign in/register, `/forgot-password`, `/reset-password` | Signed-out users | Shared card typography, geometry, inputs and buttons; existing account-separation notice retained | Typecheck/build; authentication logic unchanged |
| `/status`, `/status/incidents/:id` | Public | Shared buttons/dialogs and inherited theme; existing public status layout retained | Public status screenshot at 844×390 rendered successfully |
| Not found / application failure states | Public / signed-in | Shared surface language; original recovery actions retained | Typecheck/build; query failure/retry regressions |
| Service-selection wizard and in-app prompts | Existing eligible users | Shared cards/dialogs/inputs/buttons without changing eligibility or modal ordering | Shared-control regressions; typecheck/build |

### Admin section inventory

All existing section content remains inside the styled Admin Portal shell.
Management permissions, master-only restrictions and separate navigation targets
are unchanged:

- Overview; Users; Admin Management.
- Services; Alerts; Service Updates; URL Monitoring.
- Support Tickets (existing ticket route); Messages (existing messages route);
  Quick Responses; Reports/Requests; Email Templates; Notification Wording;
  Support Away; Ticket Auto-Close; Admin Chat.
- News; Promotions; Downloads; Announcements; Knowledge Base; Changelog.
- Chat Admin; Online Now.
- Telegram; Discord; WHMCS Billing; Billing.
- Logs; Error Log; Business Hours; Deploy.

## Verification summary

- TypeScript and ESLint passed.
- Focused component/logic checks cover dashboard alert guidance and destinations,
  latest-update selection/focus/reduced motion and update-read failures, admin
  overview/changelog, service-update targeting, error recovery, shared geometry
  overrides, status text contrast in both themes, condensed page headers,
  keyboard-aware bottom navigation, bounded composers and long alert forms.
- Production frontend/server build passed. The existing duplicate `target`
  warning in `tsconfig.json` remains unrelated to this change.
- The application workflow restarted and served port 5000. Existing development
  WHMCS read failures were still present; no new startup exception was observed.
- A public status screen rendered in a phone-landscape-sized screenshot.
  The portrait screenshot encountered the existing loading splash. The capture
  browser is signed out: **customer/admin signed-in screens, real keyboard
  geometry and full messaging interactions were not visually verified**.
  Component tests do not substitute for browser geometry measurements.

## Production build size comparison

Compared the same production build command before and after the refresh,
compressing each emitted JavaScript/CSS asset individually with gzip:

| Measurement | Before | After | Change |
| --- | ---: | ---: | ---: |
| JavaScript/CSS asset count | 70 | 70 | 0 |
| Total emitted JS/CSS bytes | 2,882,597 | 2,887,332 | +4,735 |
| Total individually gzipped bytes | 802,483 | 803,814 | +1,331 (about 0.17%) |
| CSS bytes | 161,844 | 165,232 | +3,388 |
| Gzipped CSS bytes | 26,038 | 26,693 | +655 |

This is the full emitted asset set, not the initial navigation's transfer size.
The small increase pays for shared styling and the latest-update navigation;
no runtime speedup or reduced initial-download claim is made.

## Boundaries

Dashboard maximum width remains dashboard-only. Shared styling does not set chat
heights, editor growth, keyboard insets, phone/desktop breakpoints, admin table
dimensions, upload limits or message action permissions. Card overrides retain
semantic backgrounds and caller-provided compact spacing. Status words/icons
remain visible alongside color, and status text has theme-specific contrast.
