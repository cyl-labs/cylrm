<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Outreach CRM (cylrm)

## Where the rest of this lives

**This file is the always-loaded core** — the traps, the deploy rules and the
conventions that apply whatever you are touching. It is read into every session,
so it has to stay small, and it went 50% over the limit by growing a full
history of every feature in it.

Those histories are not gone and not shortened. They live under `docs/` and are
**not** loaded automatically. **Read the relevant one before changing that
area**, the same way you read `BLUEPRINT.md` before a product decision. They are
long because the reasoning is the point — each one is mostly a record of what a
mistake cost and why the code is shaped the way it is, so skipping one is how a
fixed bug comes back.

| Working on | Read first |
| --- | --- |
| Call lists, the dialler, importing and dedupe, splitting a niche, the work order, missed calls, Stats, the Spreadsheet, the board, the Keypad | `docs/cold-calling.md` |
| Meetings and the Cal.com sync, attendance, the ring back after a no show, contracts (DocuSeal), texting a prospect, the Texts screen, push reminders and the digests | `docs/meetings.md` |
| Browser dialling, caller ID and lines, recordings and transcripts, conferencing a third party in, the call line provider | `docs/telnyx.md` |
| The SOP library, scripts and objection sheets, Slack reporting, printable handouts | `docs/sop.md` |
| Logins and roles, the Team screen, list ownership and how every calling query is scoped | `docs/staff-accounts.md` |
| What a caller is owed, payouts, the attendance fee and what counts as showing up | `docs/payroll.md` |
| A lead's own clock, the 9-to-5 filter, and flagging calls placed outside it | `docs/lead-hours.md` |
| The weekly call quota and the strip under the header | `docs/quota-bar.md` |
| US DNC screening — built, verified and deliberately switched off | `docs/dnc.md` |
| Telegram alerts when a genuine reply lands (email side) | `docs/reply-alerts.md` |
| How the build got here: phases 0-7, what is done, what the prod wipe kept | `docs/status.md` |

Two rules survive that split and are repeated here because they bite from
anywhere: **most Call CRM migrations must be applied before the code is
deployed** (several take the whole app down otherwise — each doc says which),
and **`drizzle-kit push` drops any index not declared in `schema.ts`**. See
**Gotchas** below.

## Git workflow (multiple sessions edit this repo)

Remote: `github.com/cyl-labs/cylrm`, branch `main`. A SessionStart hook in `.claude/settings.json` runs `git pull --rebase --autostash` when a session opens. In addition: run `git pull --rebase --autostash` before starting any new piece of work mid-session, and commit + push promptly after completing one — unpushed work is invisible to the other sessions and causes conflicts.

Internal cold outreach console. The full product spec — schema, scheduler/poller rules, metrics definitions, screens, and build phases — lives in `BLUEPRINT.md`. Read it before making product decisions; it is the source of truth.

## Layout / responsive

The app is used on phones as well as desktops. Conventions:

- **Write every caller-facing screen for somebody who is not a software
  person.** The floor did not choose this tool, will not read documentation for
  it, and meets a new feature between calls — so a screen has to teach itself
  on the way past. In practice: name a thing what it is from the reader's side
  ("Your calls", not "Every call"); put a plain sentence under a heading saying
  what the numbers counted, not the ratio an admin would read; label the
  control rather than leaving an icon or a bare number to be guessed at; and
  give every empty state a reason and a way out, because a screen of zeroes is
  read as broken rather than as a day that has not started. It is the same
  instinct as the dial card's booking steps — the answer is what to do next,
  not a definition. Vocabulary that appears in Payroll or on the Scoreboard
  ("pickup") stays as it is even where a friendlier word exists: a caller has
  to be able to match what they read here with what they are paid.

- The sidebar in `src/app/(app)/layout.tsx` is desktop-only (`hidden lg:flex`); below `lg` the same nav is a drawer (`src/components/mobile-nav.tsx`) whose trigger `PageShell` renders to the left of the page title, so a phone gets one header rather than two. `PageShell` is `async` because it counts unread replies and callbacks due for the drawer's badges.
- **The phone drawer folds the lesser screens** (2026-09-15, `NavLinks grouped`, `NAV_GROUPS` and `WorkspaceLink.group` in `lib/workspace.ts`). At fifteen Call CRM screens the list ran off an iPhone with Log out below it. Missed calls to Texts stay flat, since they are the work order and carry the badges, so **never put a badged link in a fold**. Below them sit Tools, Results and Admin, closed by default. Each lists what is inside when closed, and the fold holding the current page opens by itself. A fold with one link renders flat, which is a caller's Results (My stats only). The list scrolls on its own so Dark mode and Log out stay pinned, and only a link closes the drawer. **The desktop sidebar folds the same way now too** (2026-09-23): it used to ignore `group` and stay flat on the grounds that desktop has the height, but height was never the complaint — fourteen flat links read as crowded regardless of whether they fit, most visibly on the shared Founders login, which sees every admin screen. `AppLayout` now passes `grouped` to the same `NavLinks` the drawer uses, so the two surfaces cannot drift into different sets of folds.
- Screen padding is `px-4 sm:px-6` (`sm:px-7` for the two `px-7` screens); filter controls are `w-full sm:w-<n>`. Tables stay tables and scroll inside their bordered container — no card-per-row rewrites.
- The pipeline boards are snapping horizontal scrollers on narrow screens and grids on wide ones (email at `lg`, calling at `xl` — it has seven columns). HTML5 drag events still never fire on touch, so dragging on a phone is rebuilt on pointer events in `src/components/kanban/use-touch-drag.ts`: hold a card ~240ms to pick it up, and the board pans itself while a finger sits near an edge. Every card keeps its menu — that is the keyboard route, and on the calling board the only way to reach the outcomes no column stands for.
- `useTouchDrag` keeps its callbacks in a ref on purpose. They were dependencies of `end`, whose identity changed every render, so the unmount cleanup that calls it ran on every render and cancelled the hold timer — the gesture never started. Its auto-scroll is a per-frame loop rather than one tick per `pointermove`, because a finger parked against the edge stops producing move events and the pan would stall.
- `components/ui/sheet.tsx` deliberately sets no width for left/right sheets: the widths it shipped with were data-attribute-qualified (`data-[side=right]:w-3/4`), which outranks a plain `w-full` from the caller, so per-sheet widths were silently ignored. Callers set their own width.
- Check work with Playwright at 390px (iPhone), 768px and 1440px, asserting `scrollWidth === clientWidth` — horizontal overflow is the failure mode that screenshots hide.
- **Dark mode is a toggle in the sidebar and the phone drawer** (2026-09-14, `components/theme-toggle.tsx`, `next-themes`). Per browser, saved as `cylrm-theme` in localStorage, light by default, no "follow the system" option. The provider is mounted in the **app** layout, not the root one, so `/login` and the public `/u` unsubscribe page stay light — the second is read by people we email. The `.dark` palette in `globals.css` is **Claude's dark theme** — page #262624, surfaces #30302e, text #faf9f5 / #b1ada1, clay accent — at the founders' request, after a first warm-brown version looked off. It was shadcn's stock blue-grey before either. **The sidebar is #30302e, the same as the page header and the cards, not a darker strip**: it shipped as #1f1e1d, three shades met in the top-left corner, and the founders said the sidebar did not match. A screenshot of claude.ai measured its sidebar lighter than its page and the same colour as its chat box, which is also the light theme's own structure (sidebar, header and cards all white). The active nav item uses `--sidebar-primary`, a lighter clay (#eb9a7c) in dark only, because #dd7f60 on its tint over #30302e is 3.96:1. Two readability departures from claude.ai: the clay is #dd7f60 rather than #d97757, because small clay text on a card measured 4.24:1 at the original, and buttons take dark text on it because white is under 3:1. A palette of cream text and #E67D22 orange that circulates as "Claude's dark mode" is from code-editor themes, not the website. **Hard-coded dark tints must sit a step above #262624**: the script's prospect grey was #26262a, the page colour to the eye, until it moved to #3a3a37. **Colour through the tokens or a `dark:` variant, never an inline `style` colour**: an inline hex cannot be reached by the theme, which is how the transcript bubbles in `recording-sheet.tsx` rendered light pink under light text. The toggle shows both labels and lets CSS pick, because reading the theme during render is a hydration mismatch. **The provider's options are written inside `AppThemeProvider`, not passed from the layout**: a plain constant exported from a `"use client"` module reaches a server component as a reference, not a value, so spreading one into the provider silently handed it no options at all and the toggle did nothing.
- **Times typed into the app need a zone too, not just times rendered by it.** `<input type="datetime-local">` sends "2026-08-07T13:00" with no offset; `new Date()` resolves that in the server's zone (UTC on the droplet), so callbacks booked for 1pm were stored as 13:00Z and shown as 9pm. `parseCallbackAt` in `src/lib/call-time.ts` is where that is settled. Reproduce with `TZ=UTC npm run dev`; a laptop on Singapore time agrees with the naive parse and hides it.
  - **A callback is read in the prospect's zone, not the floor's** (2026-09-17). It was Singapore for every lead, which is right for a Singapore prospect and wrong for every US one: "9am" typed for a Florida business stored 9pm the *previous evening* their time. Measured on the live diary the day it changed — **9 of the 12 outstanding callbacks were outside the prospect's 9 to 5**, several at ten at night — and it was invisible, because the diary rendered every time in Singapore with nothing naming the clock. A caller reads a tidy 9:00 AM and rings somebody's evening.
  - **The zone comes from `zoneForLead`, which is built on `leadZone`** rather than restating it. That fragment already settles the scraped US state, then the area code, then Singapore and the UK by prefix, and a second copy of those rules is how the time a callback is *stored* in drifts from the time it is *shown* in. Of 5,231 leads, 5,100 resolve and **131 fall back** — all toll-free, which belong to no place. The fallback is the floor's own clock and every label says so out loud, because a silent fallback is how somebody books an evening call believing otherwise.
  - **`+08:00` as a constant is gone, and must not come back.** It only ever worked because Singapore has had no daylight saving since 1982; America/New_York moves twice a year, so a fixed offset cannot express it. `wallClockIn` looks the offset up *at* the instant being named, and does it **twice** — the first guess can land the wrong side of a DST boundary, which is precisely the case this exists for. Verified across EDT, EST, PDT, BST, Honolulu (never DST) and both 2026 boundaries.
  - **Four screens touch this and only two display it.** The dial card, the missed-calls row and the diary all offer the box (`defaultCallbackAt(tz)` opens on the prospect's tomorrow morning, `callbackZoneLabel(tz)` names the clock); the diary and the Spreadsheet render the promised time. The Pipeline board needs nothing — `due()` is arithmetic on instants, and a relative duration is correct in any zone. The Spreadsheet's callback column has **its own formatter**: it shared `fmt` with "last called at" until this change, and moving both would have dragged the record of when *we* rang into the prospect's clock, which is a different question.
  - **Callbacks set before this are stored instants and did not move.** They mean what the old rule meant, so the nine already outside the prospect's hours are wrong times somebody agreed with a prospect — a data question, deliberately not silently rewritten.
- **Dates in client components need a fixed timezone and locale.** The droplet runs UTC and the team's browsers are in Singapore, so `toLocaleString(undefined, …)` rendered one string on the server and another on hydration, and React discarded the tree on every load of the spreadsheet. A zone is therefore always passed in from the server, never left to `undefined`; the email side passes `sendingTimezone` explicitly for the same reason.
  - **Which zone: the reader's, from `readerZone(userId)` in `lib/users.ts`** (2026-09-18). It resolves the timezone picker on Stats, then the caller's market, then Eastern — the same answer Stats and the Scoreboard already used, so one choice now governs every screen. Four places were hard-coded to `Asia/Singapore` and were not: the Spreadsheet's call times, the Pipeline's "called today" filter, Team's join dates, and the callbacks diary's fallback. The Spreadsheet was the loud one — a US caller read "3:04 PM" against a call placed at 3am their time — but the Pipeline's was the one that changed a *number*, since which calendar day a call lands on decides whether it is in the filter at all. `CALL_TZ` and `callTzDate` are gone; do not reintroduce a display-zone constant.
  - **The quota bar's "from Fri 9 PM" stays Eastern on purpose** (`page-shell.tsx`). It names the instant the week is cut at, which is an Eastern fact — rendering it in the reader's zone would name an hour the reset does not happen at.
  - **A lead with no zone of its own is read on the reader's clock, and the label says so** ("your clock, no zone for this number"). That fallback is resolved by the *caller* and passed as one zone to `parseCallbackAt`, `defaultCallbackAt` and `callbackZoneLabel`, rather than hidden in a default argument: a constant on the write path and another on the read path is exactly how the time a callback is stored in drifts from the time it is shown in. Relative strings ("3h ago") cannot be pinned, so those nodes carry `suppressHydrationWarning` — they can straddle a rounding boundary between render and hydration. A local dev server hides all of this, because it shares the browser's timezone: reproduce with `TZ=UTC npm run dev` and a `timezoneId: "Asia/Singapore"` browser context.

## Stack

- Next.js (App Router, `src/` dir), shadcn/ui + Tailwind v4, TanStack Table
- Postgres via Drizzle ORM — schema in `src/db/schema.ts`, client in `src/db/index.ts`, config in `drizzle.config.ts`
- Signing in lands in the **Call CRM** (`/` redirects to the call workspace's home): that is where the people with logins spend the day, while the email side runs itself on the scheduler. `src/app/page.tsx` is the one place that decides.
- Auth: per-employee accounts in `app_user`, scrypt-hashed, with an iron-session cookie carrying `userId`; middleware in `src/middleware.ts` guards everything except `/login` and `/api`. `APP_PASSWORD` is no longer a login — it only seeds the first admin. See **Staff accounts** above.
- Gmail, split by direction:
  - **Outbound: Gmail API over HTTPS** (`src/lib/google.ts`, `messages.send`) with per-account OAuth refresh tokens — this dodges the droplet's SMTP port block. GCP project `outreach-crm-503406`, OAuth client "Outreach CRM Production", app in **Testing** status: refresh tokens expire ~every 7 days, so accounts flip to `needs_reconnect` on auth failure and show a "Reconnect Google" action on the Accounts screen. Connect flow: `/api/google/connect` → consent → `/api/google/callback`.
  - **Inbound polling is switched off** (2026-09-22, `EMAIL_POLLING` in `lib/email-polling.ts`). Cold email stopped end of July 2026 when the domains went to spam: both campaigns paused, nothing sent since 31 July, and the Gmail app passwords have since been revoked — all eight mailboxes answer `Invalid credentials (Failure)`. **The Email CRM is deliberately left intact**; the flag is the whole of turning it back on, after regenerating the app passwords in Google. It was not failing quietly: `connect()` sat outside the `try`, so an auth failure skipped the `finally` and abandoned the client, and 60s later `socketTimeout` fired on an ImapFlow with no `'error'` listener — an uncaughtException, eight per tick, ~2,300 a day, 74,691 of them and 19MB of PM2 log. Both halves are fixed, so the flag is a decision rather than a workaround. The campaign preflight **blocks** activation while polling is off: it used to check `app_password is not null`, which is that a credential exists, not that it works.
  - **Inbound: IMAP** (`imap.gmail.com:993`) with per-account **app passwords** — used both for verification at connect time and by the Phase 5 poller. Do not remove the app-password flow; sending and polling use different credentials. The Google OAuth connect flow does NOT set an app password, and `POST /api/accounts` refuses an email it already knows, so an OAuth-connected account gains one via `PATCH /api/accounts/[id]` with `appPassword` ("Add app password" in the account menu), verified with a real IMAP login before storing. Without it an account sends fine and never sees a reply, so the activation preflight blocks when no sending account has one and warns when only some do.
  - Both secrets encrypted at rest with AES-256-GCM (`src/lib/crypto.ts`, key = `TOKEN_ENCRYPTION_KEY`).

### Adding and replacing people (2026-09-15)

Setting somebody up to call is done entirely on Team, so a new hire or a
leaver never needs a Telnyx session or a developer. Routes `POST /api/users`
and `POST /api/users/[id]/replace`; Telnyx work in `provisionLine`,
`createLineConnection` and `handOverLine` (`lib/telnyx.ts`); the number rule in
`lib/team-numbers.ts`.

- **Add person takes a market, how they dial and a number**, and a picked
  number gets its line built there and then: a credential connection
  `cylrm-<username>` copied off `TELNYX_CONNECTION_ID` (webhook, voice profile,
  codecs, region — copied at creation, so a change to the shared line reaches
  new hires without a deploy), the number pointed at it, and the number put on
  `cylrm-sms`. Picking a number from a row's dropdown does the same through
  `PATCH /api/users/[id]`. Idempotent, and the connection id is saved the
  moment it exists, so a failure part-way retries onto the same line.
- **Telnyx ids are 19 digits**, so `telnyxExact` quotes long integers before
  parsing: `res.json()` rounds them into a different line. Blank template
  values are dropped from the create body (`withoutBlanks`) rather than sent as
  nulls.
- **A line that fails to build does not undo the account.** The response
  carries `lineWarning`, the handover card shows it, and picking the number
  again on their row retries.
- **Anyone with a line of their own logs in the way that can be rung**
  (`usesSipLogin`). `TELNYX_SIP_LOGIN_USERS` is no longer read;
  `TELNYX_TOKEN_ONLY_USERS` puts a person back on a token, which dials out but
  cannot be rung. The login is chosen when the page mints its token, so any
  change needs a reload on the caller's side.
- **Replace** is for an active caller who is leaving. One transaction creates
  the new account with the leaver's market, stats zone, dialling method,
  keypad, hints and panel; moves `telnyx_did` and `telnyx_connection_id`;
  moves `call_list.assigned_user_id`, and callbacks with it; moves missed calls
  still owed a ring back and inbound texts (`user_id`); and switches the leaver
  off, which ends their session. Their calls, payouts and the ring-backs they
  already did stay theirs. Afterwards `handOverLine` renames the connection and
  **replaces its SIP password**, since the leaver's browser was handed it every
  day; a failure there is reported rather than refused, because routing
  already works.
- **The sign-in details are shown once**, in place of the form, with a copy
  button. Neither dialog closes itself on success for that reason.
- **Tested against a stand-in Telnyx** (`TELNYX_API_BASE`), plus one throwaway
  real connection created, compared with the template and deleted, and an
  idempotent run against Mico's real line that changed nothing. **Never test
  Replace against a real line**: it changes that line's password, and the person
  holding it loses their phone until they reload.
- **No numbers are bought here.** Buying is a founder's decision on Telnyx;
  the form says when a market has no number left to give.

### Incoming calls ring out loud (2026-09-15)

`components/calls/ringer.ts`, started from `CallLineProvider` while
`line.incoming` is set, in the tab that holds the line.

- **A ringtone and, when the CRM is not the focused window, a system
  notification.** The banner alone was silent. On 2026-09-15 Harry's browser
  was rung for 35 and then 61 seconds (Telnyx: 487 cancelled, 480 no answer)
  while he was looking elsewhere, and two more calls were refused 480
  `SUBSCRIBER_ABSENT` because no tab was registered at that moment.
- The tone is made with Web Audio (440 + 480 Hz, two seconds on, four off), so
  there is no file to host. Browsers only allow sound after a click on the
  page; a freshly reloaded tab nobody has touched may stay silent, which is
  what the notification is for. It only shows if permission was already granted
  (`PushGate` asks on first visit).
- **No tone when already on a call**: it would ring over the prospect. The
  banner still says a second call is waiting.
- **An answered call must be told where to play** (`call.answer({ remoteElement })`
  in `use-telnyx-call.ts`). A call we dial gets its audio element in `newCall`.
  An invite arrives with none, and the SDK's attach silently does nothing with a
  null element. So until 2026-09-15 whoever answered in the browser heard
  silence while being heard perfectly. Found when Founders rang Omar's browser
  from the Keypad: both channels of the dual recording carried a voice, and Omar
  heard neither Founders nor the agent merged in afterwards. **If one side of a
  call is silent, pull the recording before suspecting the mic or the network.**
  A voice on the recording's channel means it reached Telnyx.
- **The banner is a fixed overlay, so it must be opaque** (fixed 2026-09-16).
  `InboundListener` renders it `fixed inset-x-0 top-0 z-50` over whatever
  screen the call lands on, and `IncomingCall` filled itself with
  `bg-success/10` — a 10% tint. On a phone that meant the header, the quota bar
  and the page text all read through the banner at once, with its border drawn
  on top, so it looked like a rendering fault rather than a transparency one.
  It is now `bg-card` with the green as its own tint layer inside, plus
  `shadow-lg` like the ongoing-call bar in the same file. **Anything else
  rendered `fixed` over a screen needs a solid surface for the same reason** —
  a tint is only safe in normal flow, which is why the dialler and the Keypad
  never showed this.
- **Two CRM tabs means one holds the line** (`line-presence.tsx`), and only
  that tab shows the banner. Switching screens can move the line between tabs,
  and for the seconds that takes the phone cannot be rung. Worth telling
  callers to keep one tab.
- **A missed call from a number matching no lead cannot be dismissed as a
  stranger.** Built and withdrawn the same day at the founders' request: it is
  usually a business owner ringing back from their own phone. The row says so
  instead, pointing the caller at the businesses they rang just before, and
  telling them to ask which business they are with and their timezone. The
  incoming-call banner says the same for an unknown number. Asked for after
  Harry spoke to "Angel" on a Colorado mobile, agreed a Thursday 1pm demo and
  had no business name to book it against.
- **Missed calls and Texts have a Call back button**
  (`RingBackButton`, `components/calls/ring-back-button.tsx` — not the older
  `CallBackButton`, which links into a lead's dial card from Callbacks and
  Meetings). Before it, ringing somebody back
  from the browser meant copying the number, opening the Keypad and pasting.
  It dials from the number they rang or texted, sets the active lead so the
  outcome logged on the row joins the recording (`/api/inbound-calls/[id]`
  now takes `telnyxSessionId`), and renders nothing without a live browser
  line or when the number is screened out — the copy button covers both.

## Local dev

```sh
docker compose up -d        # Postgres 17 on localhost:5433
cp .env.example .env.local  # then fill in secrets (already done locally)
npx drizzle-kit push        # apply schema (needs DATABASE_URL exported)
npm run dev
```

`.env.local` holds `DATABASE_URL`, `APP_PASSWORD`, `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, `CRON_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`.

## Deployment (crm.cyllabs.com)

DigitalOcean droplet `178.128.28.158` (host `wilnor`, shared with n8n/swee/docuseal — 1 vCPU, 2GB; do NOT run `next build` there, build locally and rsync `.next`):

- **Deploy with `./scripts/deploy.sh`** (or the `/deploy` slash command; `--dry-run` to preview). It warns on uncommitted/unpushed work, checks SSH, builds locally, rsyncs, reinstalls deps on the droplet only when `package-lock.json` changed, restarts PM2, and smoke-tests the login page. There is no CI and no git checkout on the droplet — deploys are push-from-laptop and only happen when a person asks.
- **The restart waits for a gap between calls, and the check lives in the same
  remote shell as `pm2 restart`.** A restart does not drop a call — the audio
  runs browser-to-Telnyx — but it can lose the outcome logged at the end of one,
  which is a call that happened and cannot be proved.
  - It used to check once at the top and then build, rsync and seed for the
    better part of a minute before restarting, so a call that *started* inside
    that window was never seen. On 2026-09-07 the guard passed on an empty read
    and pm2 restarted eleven seconds into a call. The query and the restart are
    now one `ssh … bash -s`, so milliseconds separate them instead of a build.
  - **The check at the top only warns now.** Refusing there is what taught
    somebody to poll for a gap between two calls and run the deploy into it —
    the exact failure above. It exists to save a wasted build, nothing more.
  - A floor dialling continuously has no quiet moment, only the seconds between
    one call and the next, so the restart polls every 5s for up to
    `RESTART_WAIT_SECONDS` (600) and reports every 30s. On timeout it exits 1
    **with the files already shipped and the app still on the old build** — the
    message says so, because that half-state is invisible otherwise.
    `FORCE_DEPLOY=1` skips the wait entirely.
  - Both checks **fail open**: an unreachable psql restarts anyway, on the
    grounds that a droplet whose database cannot be reached has a worse problem
    than a restart.
  - **The guard watches calls, not the browser phone, and those are not the
    same thing** (2026-09-16). `restart_when_clear` reads `app_user.on_call_since`
    with a 45-second `presence_at` heartbeat, which is the right test for "is
    anybody mid-conversation" and says nothing about a browser that is merely
    *registered*. A restart still 502s `POST /api/telnyx/token`: Caddy logged
    exactly that from a founder's browser at 15:35:51 during a deploy, while
    the floor was between calls. So a deploy into a legitimate gap can still
    knock somebody's phone off its SIP registration for the seconds the app
    takes to come back, and the next inbound call to them gets refused
    **SIP 480 SUBSCRIBER_ABSENT** — which is indistinguishable, from the
    caller's side, from nobody being there. Worth knowing before blaming the
    network for a call that would not connect just after a deploy.
- Code lives at `/root/crm`; the script's shipping step is
  `rsync -az --delete --exclude /node_modules --exclude .git --exclude ".env*" --exclude .claude ./ root@178.128.28.158:/root/crm/`
  after a local `npm run build`, then `pm2 restart crm crm-worker`.
  The exclude MUST be anchored (`/node_modules`, not `node_modules`): Turbopack puts external-package stubs in `.next/node_modules/`, and an unanchored exclude strips them, breaking every route that imports imapflow/mailparser/nodemailer with "Failed to load external module". Keep `/root` on the droplet free of stray `package-lock.json` files for the same reason (workspace-root inference).
- TLS/routing is **Caddy** (`/etc/caddy/Caddyfile`), not the leftover nginx configs. `crm.cyllabs.com → localhost:3005`. Validate with `caddy validate` before `systemctl reload caddy`.
- PM2 runs `crm` (Next on port 3005) and `crm-worker` (5-min loop hitting `/api/cron/scheduler` + `/api/cron/poller` with `CRON_SECRET`) from `/root/crm/ecosystem.config.js`.
- Postgres 17 in docker (`cylrm-db`), bound to `127.0.0.1:5433`, persistent volume. Schema changes: run `drizzle-kit push` from local through a tunnel (`ssh -L 15433:127.0.0.1:5433 root@...`).
- Secrets in `/root/crm/.env` (never committed).

## Gotchas

- `drizzle-kit` does not read `.env.local` on its own: `set -a && source .env.local && set +a && npx drizzle-kit push`
- `drizzle-kit push` goes **interactive** when a diff both drops and adds an enum — it asks whether it's a rename, and `--force` does not suppress that prompt (it only auto-confirms data-loss statements). With no TTY it just crashes in `promptNamedWithSchemasConflict`. Apply that kind of change as explicit DDL over psql instead, then re-run `push` to confirm the schemas agree.
- **`drizzle-kit push` drops any index that is not declared in `schema.ts`.** `call_user_id_idx` was created by `2026-08-13-app-user.sql` and never added to the schema file, so the first push after it silently removed the index every per-person query relies on. Both it and `call_telnyx_session_id_idx` are now declared on the `call` table. An index that exists only in a migration will not survive; put it in both places, and check `pg_indexes` after any push.
- **`call` needs `call_lead_latest_idx`** (2026-09-14, `2026-09-14-call-lead-latest-idx.sql`). Every calling screen asks for each lead's latest call (`latestCall`, a lateral subquery per lead), and with no index on `call_lead_id` Postgres read the whole calls table once per lead. The sidebar's callbacks count runs on every page, so every page paid about a second; Callbacks took ~4s, Spreadsheet and Pipeline 6–11s. Built on prod `CONCURRENTLY` and declared in `schema.ts` so a push keeps it. Server time per sidebar click afterwards: light pages ~0.1s, Callbacks ~0.5s, Call lists ~0.4s, Spreadsheet and Pipeline ~1.7s, Stats ~1.5s. **If a calling screen goes slow again, check this index still exists before anything else.** Keypad (~0.9s) and Team (~0.65s) did not move: they wait on the Telnyx API, not on this.
- **The `offset 0` in `leadZone` is load-bearing; deleting it makes every
  calling screen four times slower** (2026-09-22, `lib/calls.ts`). That
  fragment resolves a lead's timezone in a `cross join lateral`, and Postgres
  flattens such a lateral into the outer query — so `z.tz` is not a column, it
  is the whole expression pasted in afresh at **every mention**. It is
  mentioned a lot: `withinLeadHours` names it five times and `getCallTotals`
  tests that twice per row, so each call row parsed a 3KB `source_fields` blob
  and walked an 84-branch state CASE ten times to get the same string ten
  times. `offset 0` is the standard optimisation fence against the pull-up and
  cannot change a result, only the plan. Measured on prod over a week of
  calls: `getCallTotals` **1,688ms → 252ms**, byte-identical output; Stats
  6.0s → 1.5s, Callbacks 2.3s → 0.9s. Timed on its own the state CASE looks
  innocent (171ms), which is how it stayed hidden — the cost is only visible
  when you count how many times it runs. `getCallLists` keeps its own copy of
  the lateral and needs the same fence. **If a calling screen goes slow, check
  this and `call_lead_latest_idx` before anything else.**
- **Nothing that renders with a page may cost a query per person** (2026-09-22).
  Stats' quota card asked `getWeekProgress` for each caller in turn, and that
  answers through `getCallTotals` — eleven figures, of which it read one. It
  is one grouped count now, and the card fetches it from
  `/api/quota-standings` when a founder presses the button rather than on
  every page load. The restated count has to keep matching `getCallTotals`,
  the join to `call_lead` included.
- **`getCallLists` is hand-tuned and must stay that way** (2026-09-16). Call lists, Callbacks, a list's dial screen, Spreadsheet, Pipeline and Stats all run it, over every list and every lead. The four-call limit and call spacing first added two correlated counts per lead to `latestCall` and joined `leadZone` for every lead, and that one query went from 0.37s to **1.49s** on 5,231 leads — every one of those screens sat at 2–4s. Measured by watching `pg_stat_activity` while a page loaded, then timing rebuilt versions directly. It now counts tries in one grouped pass over `call`, each list's call counts in another (they were six correlated rescans per list), skips the recording and caller-name lookups it never reads, and works out a timezone only for leads waiting on a retry, with the area-code join written as a plain equality so it can hash: **0.26s, identical numbers for all 41 lists.** The price is that it restates the latest-call, retry and timezone rules rather than reusing `latestCall`/`leadZone`, so a change to any of those rules has to be made there too. Removing the Email CRM would not have helped: its screens and its one sidebar count were never on the slow path. **Business hours are never tested inline there, or in the sidebar callbacks count**: waiting callbacks come from `waitingCallbacksByList` and are subtracted, because the inline version took the badge from 30ms to 1.8s.
- **Writing jsonb: Drizzle is safe, the raw postgres.js client double-encodes.**
  Measured against prod on 2026-09-16. `db.execute(sql\`… ${JSON.stringify(x)}::jsonb\`)`
  through **Drizzle** stores a real array or object — it binds the string as a
  plain text parameter and Postgres parses it at the cast. The identical
  expression through the **raw `postgres()` client** stores a jsonb *string*,
  because that driver JSON-encodes a parameter bound to a jsonb target; this is
  true of both the tagged template and `client.unsafe()` with a positional
  parameter. Use `sql.json(x)` there.
  - It fails silently and only on read: `Array.isArray(row.col)` is false, so
    the feature reads as "there is no data" rather than as an error. That is
    how `call_recording.transcript_turns` came to hold 66 strings against 31
    arrays (`2026-09-16-transcript-turns-unwrap.sql` unwraps them losslessly
    with `#>> '{}'`), and the route that writes it was never the culprit.
  - **One-off scripts are the risk**, since those are what get written against
    the raw client — the `node --env-file=.env` pattern used to query prod. If
    a script writes jsonb, check `jsonb_typeof` afterwards rather than trusting
    the write.
- **Never interpolate a Drizzle column into a subquery inside `.select()`.** Drizzle renders interpolated columns *unqualified* there, so ``sql`(select count(*) from ${call} where ${call.userId} = ${appUser.id})` `` emits `where "user_id" = "id"`, and inside `select ... from "call"` that bare `"id"` binds to `call.id` instead of the user's. It fails silently: the subquery correlates with nothing and returns one constant for every row, which looked like a plausible 0 for everyone on the Team screen until a backfill turned it into a plausible 1 for everyone. Either write the identifiers out literally and qualified (as `campaigns/page.tsx` does — `"enrollment"."campaign_id" = "campaign"."id"`), or use a LEFT JOIN, where two tables force Drizzle to prefix both sides. Check with `.toSQL().sql`, not by eye.
- **Never write `= any(${array})` in a Drizzle `sql` template.** Drizzle spreads
  a JS array into `($1, $2)`, which Postgres reads as a row, and the statement
  fails with "op ANY/ALL (array) requires array on right side" — a single-item
  array fails too. Write `in (${sql.join(arr.map((v) => sql`${v}`), sql`, `)})`,
  the way `lib/sms.ts` and `lib/meetings.ts` do. This one cost eleven days:
  `e2c3959` put it in the Telnyx webhook and `/api/inbound-lead` on 2026-09-04,
  so every inbound call failed to save until 2026-09-15 and Missed calls, its
  badge and the work gate's first stage all silently read zero. Nothing else
  noticed, because a query that throws in a webhook reads, from outside, exactly
  like a quiet phone.
- The unified `radix-ui` barrel and current `@radix-ui/react-slot` call `createContext` at module scope, so shadcn components that use `Slot` (`button.tsx`, `badge.tsx`) need `"use client"` — do not remove it.
- Do NOT use Server Actions that set a cookie and then `redirect()` (e.g. login/logout): Next responds 303, the browser fetch follows it into a static page's HTML, and the client throws "An unexpected response was received from the server" (Next's error screen). Auth flows use plain `<form method="post">` to route handlers (`/api/login`, `/api/logout`) returning 303 with a **relative** `Location` (absolute URLs built from `request.url` leak the internal `localhost:3005` origin behind Caddy).
- Verify UI flows with a real browser (Playwright), not just curl — curl takes the no-JS path and misses client-side failures.
- HTTP/3 is disabled in Caddy (`protocols h1 h2` global option) — h3 was flaky on this droplet; leave it off.
- `sendGmail()` honors `GMAIL_SMTP_HOST` / `GMAIL_SMTP_PORT` / `GMAIL_SMTP_INSECURE=1` env overrides so dev tests can point at a local SMTP sink (see the smtp-server pattern in Phase 4's verification). Never set these in prod.
- **DigitalOcean blocks ALL outbound SMTP from the droplet (ports 25, 465, 587); IMAP 993 is open.** That's why account verification/polling use IMAP and outbound switched to the Gmail API over HTTPS (DO ticket #12611746 became moot). Do not reintroduce SMTP sending. Do not assume `smtp.gmail.com` is reachable from prod.

### Printable handouts

**Founders get an "Export as PDF" button on each SOP document**
(`/api/sop/[slug]/pdf`), which posts the handout HTML to the **Gotenberg
already running on the droplet** — a container that turns HTML into PDF and
nothing else, on `localhost:3002`, shared with the other apps there. Config is
`GOTENBERG_URL`; unset means no button and nothing else changes, the same rule
the contract buttons follow. That is why no PDF library was added: this box has
2GB of RAM and one that could render a page was already on it.

- **The renderer moved to `src/lib/handout.mjs`** so the button and the script
  cannot drift into two different documents. Plain ESM rather than TypeScript
  because `scripts/export-sop.mjs` runs under bare node with no build step.
- **`audience: admins` is refused by the route as well as the script**, and for
  a founder too. These files exist to be sent to people outside the company;
  the screen and Cmd-P are still there for anything else.
- The button never renders on a founders-only document, so the refusal is a
  backstop rather than the control — but `/api` is outside the middleware
  matcher, so the route checks the role itself.


`node scripts/export-sop.mjs [slug…]` renders the SOP markdown into
standalone HTML under `handouts/` (gitignored — it is derived). Open one in
Chrome and print to PDF; the print stylesheet is what the page is designed
around, so what comes out matches the screen.

- **It exists because the handouts were a hand-made copy.** Two PDFs were
  being sent to interviewees, who have no CRM account to read `/sop` in, and a
  hand-made copy of a document that changes weekly is wrong within a
  fortnight: the price had moved to $99, the objection sheet had grown from
  twelve entries to twenty and been regrouped into families, and the booking
  half of the script had been rewritten around time zones. None of it had
  reached the PDFs.
- **`audience: admins` is never exported, even when named explicitly** — it
  refuses loudly rather than skipping quietly, since somebody who asked for a
  slug by name is expecting a file. These go to people outside the company;
  `procedure-closing-the-demo` is the ROI maths and the commercial terms.
- **Section splitting, the `Family | Title` split and the branch rule mirror
  `toSections` in `src/lib/sop.ts`.** If that changes, this changes: a handout
  that numbers or groups differently from the screen a caller works off is two
  documents claiming to be one.
- It writes no PDF itself. That means shipping a headless browser or a PDF
  library to a repo that has neither, to save one Cmd-P.
