# Staff accounts (Call CRM)

Part of the cylrm project notes — the always-loaded core is `AGENTS.md`,
and the product spec is `BLUEPRINT.md`.

Employees sign in individually so every call has a name on it. The single shared `APP_PASSWORD` login is **gone**; that variable now only seeds the first admin.

- `app_user` (username, name, scrypt hash, role `admin`/`caller`, active) and a nullable `call.user_id`. Nullable and unbackfilled on purpose: the calls made before this existed belong to nobody, and the stats show them as "Not attributed" rather than inventing an owner. Schema in `2026-08-13-app-user.sql`.
- **Apply that SQL and run `node scripts/bootstrap-admin.mjs <username> "<Name>"` on the droplet *before* deploying the code** — the new login only accepts real accounts, so deploying first locks everyone out until an admin exists. The script reads the password from `APP_PASSWORD` (never an argument: that would be in the shell history and in `ps`), and re-running it on an existing username resets that account and re-admins it, which is the way back in if the last admin password is lost.
- Hashing is scrypt from `node:crypto` (`src/lib/password.ts`), not a dependency — bcrypt and argon2 are native builds, and this droplet builds nothing. Parameters are stored in the hash string so they can be raised later without locking anyone out. The login route verifies against a throwaway hash when the username does not exist, so response time does not reveal which usernames are real.
- The session carries `userId`, and the middleware requires it rather than just `loggedIn` — a cookie issued before this feature passes the old test but says nothing about who holds it.
- **Switching somebody off ends the session they already hold** (2026-09-07). `getCurrentUser` reads `app_user.active` from the database on every request, `cache()`d, for the same reason `canUseKeypad` and `callRegionOf` do: the cookie is written at sign-in and says nothing about what has happened since.
  - Until then `active` was tested **only** by the login route, so switching somebody off stopped them signing in again and did nothing at all to the session in their pocket — and the cookie lasts thirty days. Found when a caller quit two days after signing in on a personal Android. The Team screen's confirm dialog has always claimed "They are signed out and cannot log back in"; only the second half was true.
  - **`sessionOptions` and `SessionData` moved to `src/lib/session-config.ts`.** `session.ts` now imports the Postgres client and `src/middleware.ts` runs on the edge runtime, where that cannot even be bundled. Same wall `outcome.ts`, `phone.ts` and `stats-zones.ts` were built to get around; `session.ts` re-exports both so the sixty-odd `from "@/lib/session"` imports are untouched.
  - **`session.loggedIn` is not an authorisation check and must not be used as one.** It is a cookie flag. Every route guarding on it was bypassable by a switched-off account; the email ones were saved by `denyIfNotEmailUser` (which goes through `getCurrentUser`), and the two Call CRM writes that were not — `/api/calls` and `/api/call-leads/[id]` — now require `getCurrentUser`. `/api` is outside the middleware matcher, so in those routes that guard is the only one there is. **A new route takes `getCurrentUser`, never `getSession().loggedIn`.**
  - It failed *quietly*, which is why it survived: `/api/calls` wrote `userId: user?.id ?? null`, so a call logged by a deactivated employee was stored **unattributed** rather than refused — indistinguishable from the pre-accounts rows.
  - The app layout renders a "This account has been switched off" notice with a log-out button rather than an empty app. Deliberately **not** a redirect to `/login`: the middleware bounces anyone carrying a session off that page, so it would loop, and clearing the cookie is a POST to `/api/logout`.
- `/api/calls` stamps the session's user on POST. A **correction** (PATCH) deliberately leaves `user_id` alone: relabelling a mis-tap does not make someone else's dial yours.
- `/team` is the management screen — admin-only for writes, enforced in the API rather than by hiding buttons. Deactivate rather than delete: the calls stay and so do the numbers. Two guards stop a lockout — the last active admin cannot be demoted or switched off, and nobody can switch themselves off. It is named Team, **not Accounts**: Accounts is the Gmail sending accounts on the email side.
- **The row actions promote nobody** (2026-08-24). "Make admin" sat one click away in the row next to Rename and handed over every account including your own; the floor is staffed and nobody needs elevating. "Make caller" stayed, because it takes privilege away rather than granting it, and a new admin is still made deliberately by adding one with the role set. `PATCH /api/users/[id]` still accepts `role: "admin"` — the API was left alone, so this is a screen decision and reversible in one edit.
- **Team shows each person's call lists** (2026-09-14): a "Call lists" column of links, each with how many leads nobody has rung yet, red at zero. Display only — assigning stays on Call lists, which is where the red "None yet. Assign on Call lists" on an active caller with no lists points, since that caller signs in to an empty app. "Not rung" is "no call at all", the same definition as `uncalled` on Call lists.
  - `listTeam` fetched those lists in a **separate** query (a second one-to-many join multiplies every call count by the number of lists) until 2026-09-20, when it stopped fetching them at all — see the bars below. Stats, the Scoreboard and Call lists, which all call `listTeam` and never read the field, lost that query with it.
- **Each list on the Team row carries its own progress bar** (2026-09-20), and
  a niche table underneath answers "are we running out of leads". Asked for by
  the founders, who could see how many leads were left but not how close
  anybody was to the end of them.
  - **The bar is `listProgress`, the function the card on Call lists draws** —
    not a second count of the same rows. The Team page now calls `getCallLists`
    once and splits it by owner (`listsByOwner`, `src/lib/lead-stock.ts`),
    because the bar needs retries and callbacks due as well as never-rung, and
    counting those a second way is how Team comes to report one niche at 62%
    where its own card says 48%. That is why `listTeam` gave the field up: one
    query on this screen replaced it, and three screens that ignored it stopped
    paying for it. `TeamMember` no longer carries `lists`; `TeamManager` takes
    a `lists` prop keyed by user id, and `ReplaceDialog` takes a count.
  - **"No new leads" in red is the signal, not the bar.** A caller can be at
    60% and still have nothing fresh to dial, because the rest is retries owed
    — which is precisely the morning somebody sits there with a full-looking
    list and no work. A list with nothing imported into it says so instead: red
    on an empty list sends somebody hunting for the wrong problem.
  - **The niche table groups lists by name** (`nicheOf`, `src/lib/niche.ts`):
    Junk Removal 5.1, 5.2 and 2.1 are one pile of businesses, they run out
    together, and twenty-four rows saying 6% each answer nothing. The rule is
    the trailing part number only, both spellings (`partName`'s dot and the
    space the hand-made splits used). **The market suffix deliberately
    survives** — "Movers SG" is not "Movers" and "London Junk Removal" is not
    "Junk Removal"; folding those together reports leads as available to a
    floor that cannot ring them, and this table is read to decide whether to
    buy more.
  - **"Runs out in" counts first calls, not calls** (`freshStarts`). A lead
    takes up to four dials before it leaves the queue, so calls per day say how
    loud the floor was, not how fast it is eating the pile; what runs out is
    businesses nobody has spoken to, and one of those is consumed exactly once.
    Divided by **the days the floor actually rang**, not by seven: a six-day
    week over seven quietly reports a rate nobody is dialling at and buys a day
    of leads that is not there. On prod the day it shipped: Junk Removal, 24
    lists, 1,852 never rung, 230 a day, about eight days left.
  - Niches nobody is calling sit in a native `details` fold with the reserve
    counted on the summary — they are what is left to hand out, not what is
    urgent. Native for the reason the "By list" fold on Stats is: it opens
    before hydration and costs no state.
  - Both queries were measured on prod before shipping: `getCallLists` 0.26s
    (it is the hand-tuned one — see **Gotchas**), `freshStarts` about 15ms.
    Founders only, like the rest of the screen: a caller cannot assign a list,
    and telling somebody their work runs out on Thursday when they can do
    nothing about it is a worry, not information.
- **A warning at the top names whoever is about to run dry, with the fix next
  to it** (2026-09-20, `components/team/lead-warning.tsx`,
  `callersRunningOut`).
  - **A caller's share can empty while the pile is still deep**, which is why
    this is not the niche table read again: the floor can have nine days of
    Junk Removal left while Aaron personally has nothing new after eleven
    o'clock, and he will sit there until somebody notices. It is the only
    time-critical thing on the screen, so it goes above everything — including
    the numbers panel, which is fourteen rows tall and buried it.
  - **Measured at their own pace, not the floor's.** `freshStarts` returns
    fresh leads per *person* as well as per list, over the days **they** rang:
    somebody back from three days off has not slowed down, and dividing their
    week by everybody else's says they have. No pace (a new hire, or somebody
    away) means no warning unless the queue is actually empty — without a rate
    there is no answer to "how long", only a number that could be a
    fortnight's work or this afternoon's.
  - Active callers only. An admin holds the demo line, which is two leads and
    permanently "out", and a switched-off account's lists are parked rather
    than worked. A caller with **no lists at all** is included and is the
    loudest row: they sign in to an empty app.
  - **Accounts nobody uses are the exception** (`DORMANT_AFTER_DAYS`). The
    first run on prod flagged eight people, two of them logins that had never
    made a single call — one five weeks old — which is how a warning becomes
    wallpaper. Never rung anything *and* a fortnight on the books *and*
    holding no lists is a login to switch off, not a caller waiting for leads.
    The same shape in a newer account still shows: that one is a setup
    somebody has not finished.
  - Thresholds live in `src/lib/lead-words.ts` with `whenOut` — db-free,
    because a client component reads them too, and two screens disagreeing
    about whether somebody is in trouble is worse than the import.
  - **It renders nothing when nobody is short**, which is the normal state. A
    panel that is always there is one that stops being read.
  - **The heading keeps the two situations apart** ("Rainier has nothing to
    dial · 5 callers are inside 3 days"). It read "6 callers are running out"
    over a red panel, which says six people are stranded when it was one with
    nothing and five with a couple of days — and a founder who had just handed
    out two lists saw the same alarm and reasonably asked what was broken.
  - **Each row carries the division, not two numbers beside each other.** "25
    never rung" next to "rings 121 a day" leaves the reader to divide, and the
    division is the whole point: 333 leads is three days for the man who
    starts 121 a day and a fortnight for somebody who starts 25. Which is also
    the answer to "I gave him two lists and it still warns" — at 121 a day he
    needs about 360 never-rung leads to clear three days, and two lists is
    308.
- **Every row shows that person's total, whether or not they are warned**
  (`LeadTotal`, 2026-09-20): "333 never rung in all · about 3 days at 121 a
  day", under the per-list bars it adds up. Asked for straight after the
  warning shipped, and the reason is the same one: the per-list numbers never
  said what somebody had *between* them, so the only place the total appeared
  was the alarm they were trying to clear, and handing out two lists looked
  like it had done nothing. A caller with nothing new says "No new leads left
  · 34 still to ring back" — they are not idle, they are on retries.
  - **No pace, no colour** (`callerUrgency` returns nothing without one).
    Somebody who has rung nothing this week has no rate to divide by, so their
    pile is neither big nor small — it is unmeasured, and amber says the
    opposite. It painted an admin's 215 parked leads amber before that.
- **Lists are handed out from Team as well as from Call lists** (2026-09-20,
  `components/team/assign-list.tsx`). Same route — `PATCH
  /api/call-lists/[id]`, still the only thing that decides whether the change
  is allowed — so this is a second door, not a second rule.
  - Assigning belonged on Call lists, one dropdown per card, which is right
    when you are looking at the lists and wrong when you are looking at the
    person: the warning says Aaron has six leads left and the fix was forty
    cards away on another screen.
  - **Their own niche is offered first.** A caller working Junk Removal knows
    the script, the objections and what those businesses sound like; the next
    part of the same scrape is worth more to them than a bigger list in a
    trade they have never rung. Their market is next, and the lists they
    cannot ring at all are last and labelled — shown rather than hidden,
    because a founder with nothing good to give should see what exists.
  - **Undo rides on the toast**, for twelve seconds rather than sonner's four:
    the mistake worth catching is the one made ten seconds ago, and a second
    control on the row to take a list *away* is a different decision. Anything
    older goes back through Call lists.
  - The button is hidden, not disabled, on a row when there is nothing left to
    hand out — "Nothing left to give" against every name is noise, and the
    warning says it once where it matters.
- **`ADMIN_ONLY_CALL_PREFIXES` is the Scoreboard, Team and Payroll**, kept separate from `EMAIL_PREFIXES` so the two reasons stay legible — one is a different product, the other is a permission — with `isAdminOnlyPath` covering both for the middleware and `linksFor` dropping them from the caller's sidebar. `/call-stats` was on it until 2026-09-06; see below.
- **`/call-stats` is two screens sharing one page** (2026-09-06). An admin gets the floor: everyone's calls, every niche, a person picker, a By-person table. A caller gets their own and nothing else, and the page is the whole control — `mine = me?.role !== "admin"` forces `personId` to themselves and passes `scopeId` to `getCallLists`/`getListStats` for the niches they may see. **Anything added to that screen has to take one or the other**, or it will quietly show a caller the floor.
  - `?person=` is **not read at all** for a caller, and their own id is never written into a link (`personParam`): a scope that a query string can widen is not a scope, and a URL carrying a person id suggests it could carry somebody else's.
  - Not a second screen at `/my-stats`, for the reason the quota bar counts through `getCallTotals`: two ways of counting a day puts two numbers in front of one caller, and the one they read had better be the one their pay is worked out from.
  - It was closed to callers entirely until then, which cost the wrong thing. With the Scoreboard shut too (2026-09-03), the people doing the dialling had no way to see their own day, hear a call back, or check the pickup count they are paid on — none of which is anybody else's business to protect. The Scoreboard stays admin-only: what was withheld there is *everyone else's* numbers, and that is still the reasoning.
  - The tile **labels are identical on both versions** and deliberately so — a caller is paid per fifty *pickups*, the word is on the Scoreboard and in Payroll, and a friendlier one here would cut their screen off from the figure they are paid on. Only the line underneath changes: ratios for an admin, plain words for a caller.
- **A caller may hear their own calls.** `findVisibleRecording` in `src/lib/recordings.ts` is the one rule, shared by `/api/recordings/[id]` and the transcript routes — two copies of "may you hear this" is how the two end up disagreeing, and the one that is wrong is a proxy into the whole Telnyx account. Admins hear everything; a caller hears a call on a niche assigned to them, **a call they made** whoever holds that niche now, or **a keypad dial they placed**. The second matters because their Stats lists calls by who logged them, so a reassigned niche used to offer a Listen back button that 404s. The third fixed a real gap: the old query joined `call` alone, so every `keypad_call` recording was unplayable for admins too. Transcribing is open to callers as well — at about a cent for a three-minute dial the spend is not worth a permission.
- **Callers have no access to the Email CRM.** `EMAIL_PREFIXES` / `isEmailPath` in `src/lib/workspace.ts` is the single list of email screens: the middleware bounces a non-admin off them to `/calls`, the switcher hides the workspace (and renders a plain label rather than a menu of one), and the unread-replies badge is zeroed so nothing lights up pointing at a screen they cannot open. Hiding the nav is not the control — a bookmark walks straight past it. `/api` is outside the middleware matcher, so every email route calls `denyIfNotEmailUser()` from `src/lib/session.ts` right after its session check; the calling routes, `/api/users`, `/api/cron` and the public `/u` deliberately do not.
- Per-person numbers are on `/call-stats` ("By person", `getPersonStats`), admins only since that table is the floor compared against itself, and the spreadsheet has a "Called by" column reading the *latest* call's caller.
- Call lists carry an owner (`call_list.assigned_user_id`, `2026-08-13-call-list-owner.sql`), assigned from the call lists screen by an admin. **The owner is a lock, for callers.** It shipped as a label — anyone could work any niche — and that was reversed the same day, once real employees were about to get logins: an employee has no business in a niche that is not theirs, and fourteen of other people's made the screen a wall. A caller now sees only their own niches on the call lists screen, the dialler, the spreadsheet, the pipeline board and the callbacks diary, including the sidebar badge. Admins see everything and keep a Mine/Everyone toggle to narrow.
  - One helper does it: `callScope(me)` in `src/lib/session.ts` returns `undefined` for an admin and the user id for a caller, and every calling query takes it as `ownerId` and applies `ownedBy` (`src/lib/calls.ts`). A session with no user resolves to `-1`, so a bug upstream fails closed to an empty screen rather than open to the whole database. `getCallList` is scoped too, so a caller typing another team's list id into the URL gets the same not-found as a list that never existed.
  - **The consequence to remember: an unassigned niche is invisible to every caller.** Nobody is refused a call they can reach, but they cannot reach what is not theirs, so a new employee with nothing assigned sees an empty app. Assign before they start.
  - Deactivated people stay assignable on purpose: switching someone off for a fortnight should not silently strip their niches. The assign control is positioned over the card rather than inside it, since the card is one big link and a dropdown nested in an anchor navigates as it opens.
- **The Team table says how long somebody has been with us** (2026-09-18,
  "With us"), in words — "3 days", "5 weeks", "1 year 2 mo" — off
  `app_user.created_at`, with the join date on the tooltip. Words rather than a
  date because the question it answers is "is this person new", and a date
  makes the reader do the arithmetic. It sits **next to Username**, not at the
  end of the row: it went in last so it landed last, thirteen columns out past
  the Telnyx settings, and the founders asked for it beside the person rather
  than beyond a horizontal scroll. Who somebody is reads left to right — name,
  login, how long — and how they are set up follows.
