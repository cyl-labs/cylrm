# Scripts and procedures (Call CRM)

Part of the cylrm project notes — the always-loaded core is `AGENTS.md`,
and the product spec is `BLUEPRINT.md`.

`/sop` is the library callers work from: cold-calling scripts, objection
handling, and region-agnostic procedures. **Read-only in the app.** Content is
markdown under `content/sop/`, published by `scripts/seed-sop.mjs`, which
`deploy.sh` runs on every deploy — so the workflow is edit the file, commit,
deploy. There is no editor, no upload and no revision history, because the
files are in git and that is the better history. A document whose file is
deleted is removed from the table too.

- **`audience: admins` in the front matter withholds a document from the
  floor** (`sop_document.admin_only`, `2026-09-05-sop-admin-only.sql`). The
  second axis, and unlike `region` it withholds rather than routes: `region`
  decides *which* market reads a document, this decides whether the callers
  read it at all. It exists for `procedure-closing-the-demo.md` — the demo
  call, the ROI math and the commercial terms, which is a founder's job and
  not a cold caller's. Keeping it out of their library is not tidiness: a
  caller is paid $30 when a booked demo shows up, so a caller who starts
  closing instead of booking is doing harder work for nothing.
  - `listSopDocuments(region, isAdmin)` takes the flag **defaulting to false**,
    so a call site that forgets it fails closed. `getSopDocument` is scoped the
    same way, which is the only thing that makes hiding the row worth
    anything — a founders-only slug typed into the address bar 404s.
  - `getDiallerSop` filters `not admin_only` **unconditionally, admins
    included**: that is the live-call panel, and founders-only material is read
    before a demo rather than scanned mid-sentence. Nothing today is both a
    script and founders-only, so it only ever matters as the fail-closed answer
    if one is ever written.
  - The seeder **throws on an unknown `audience`** rather than reading it as
    "everyone" — a typo there would publish the founders' notes to the whole
    floor, which is the one mistake this must not make quietly. It also names
    the restricted documents in the deploy log.
  - **Apply the migration before deploying**: `listSopDocuments` and
    `getDiallerSop` both select the column, so without it the Scripts screen
    and the dialler's script panel 500 — and `seed-sop.mjs` writes it, so the
    deploy fails at its own publish step.
  - The library labels those rows **Founders**. Every row an admin sees is one
    only they can open, so the badge is not about access — it is so a founder
    can tell which documents their callers cannot see before quoting one.
- **`[your number]` is filled in with the number assigned to whoever is
  reading** (`SopFill` in `src/lib/sop.ts`, `callerNumberOf` in `lib/users.ts`,
  `spokenNumber` in `lib/phone.ts`). It is the one thing in the script a caller
  cannot look up: the number is set on Team, which is admin-only, it only ever
  appears on somebody else's handset, and the voicemail line asks them to read
  it out on every unanswered call — so the script was telling them to say a
  number nobody had ever told them. A caller asked; that is what this is.
  - **Substituted on the markdown, not the rendered HTML.** Everything a
    section carries — the HTML, the spoken half, the drawer's search text — is
    derived from that one string, so filling in there is the only way all of
    them can agree. The value goes in wrapped in a `data-fill` span that
    `SopProse` marks (bold, dotted underline, never wrapped mid-number): it has
    to read as *their* number rather than as an example left in by mistake.
  - Filled on the document page, the dialler and the Keypad. `/api/objection-
    hint` deliberately is not: it returns a category and a title, no words to
    say, and filling would mean another read per cache miss for nothing.
  - **An unassigned number leaves the placeholder standing** rather than
    dropping it — "[your number]" is visibly a blank where a sentence that
    simply stops is not. The Call lists screen says the same thing in words:
    `components/calls/your-number.tsx` labels the number for anybody who has
    one, and tells a caller who does not to ask an admin, which is the
    diagnosis for a script still showing the placeholder. Shown to every
    caller and to admins only when they have a number, since an admin reading
    "ask an admin" is a card pointing at itself.
  - **The printable handouts keep the placeholders.** `scripts/export-sop.mjs`
    renders the same markdown for interviewees, who have no account and no
    number, which is why this is a step in the app rather than something baked
    in at publish time.
  - `spokenNumber` groups the digits — "+1 907 659 2550" — because this is the
    one place a number is *said* rather than dialled. It is the opposite of
    `dialableNumber`, which strips the country code for a keypad: the prospect
    is ringing back from their own phone, so the international form is the one
    that works from wherever they are. Only shapes the app can read are
    grouped; a UK national part is left unbroken, since the grouping varies by
    range and a wrongly-chunked number reads as a different one.
  - `[your name]` and `[their trade]` are not filled today. A caller knows
    their own name, and the trade belongs to the lead rather than to them.
- **The closing procedure's "too expensive" line is filled from the demo
  calculator as it is typed** (2026-09-17, `lib/demo-calc.ts`,
  `components/sop/demo-numbers.tsx`). `[their calls]`, `[their average job]`
  and `[the package price]` became the prospect's own figures, so a founder
  answering a price objection no longer scrolls back up to cross-reference.
  - **This one is filled in the browser, not on the markdown**, unlike
    `[your number]`: the values do not exist until somebody types them. The
    two boxes moved out of `PricingCalculator` into `DemoNumbersProvider`,
    which wraps every section on the document page, and a section whose HTML
    holds one of those tokens renders through `DemoFilledProse` instead of
    `SopProse`. Every other section stays server-only.
  - **The package price is the cheapest package's bill at their volume**,
    overage included — the figure the calculator marks and the procedure says
    to quote — said in whole dollars. An empty box leaves its bracket
    standing, the `[your number]` rule.
  - **The sums live in `lib/demo-calc.ts`** so the calculator and the line
    cannot disagree, and in a plain module because the page, a server
    component, calls `hasDemoFills`: a function exported from a `"use client"`
    file reaches a server component as a reference, not something it can call.
  - **A month is 4 weeks**, at the founders' request, because ×4 is the sum a
    prospect can follow out loud. It was 4.33, and the calculator explained
    why under the figure. At ×4 the minutes run about 8% under a real month,
    so somebody right at a plan's limit can end up a little over it.
  - The term-discount line in that section still quotes Phone Professional's
    $212.50 and $187.50 by hand, whatever package the calculator picked.
- **An objection handle must be a `##` branch, never a `###` sub-beat.** A
  `###` never becomes a section of its own, so on the dial card it renders as a
  small muted heading *inside* the parent step's expansion, directly above a
  full-width tinted "YOU SAY" block — and callers read it out on every call.
  Measured, not theorised: the "Oh, it's AI" line was a `###` and was being said
  unprompted every time. A `##` whose title starts `If` / `Only if` /
  `Otherwise` matches the branch rule, so it gets its own collapsed row marked
  `↳`, takes no step number, and has to be opened deliberately. Applied to the
  voicemail message, the "what is a voice agent" explainer and the "you're
  selling me something" answer. The voicemail message went further on
  2026-09-14, because the branch styling alone did not stop it being read to
  people who picked up: it moved to the **end** of both scripts, out of the
  path of a live call, and its line is a `> **Voicemail only**` block rather
  than `You say` (see speaker blocks below). Give each one a `> **Prospect**` cue too — that
  is what the live hint matches on, and it shows the caller what triggers it.
  Coaching prose stays out of the spoken half by itself as long as the block
  after it is not a `> **You say**` line (see `splitSpoken`'s cue rule).
- **One script and one objection sheet per region, enforced by a unique index**
  (`sop_document_kind_region_idx`). So a second `kind: script` file for a
  market is refused at publish time, not silently half-used: the voicemail
  script is a `##` section inside the existing script, not a document of its
  own. Procedures are exempt and there can be many.
- **Region comes from the caller, not the lead.** `app_user.call_region`
  (`sg` | `us`), set by an admin on the Team screen. It was originally derived
  from the lead's phone number, which meant the library had to carry every
  region's document at once, labelled, so nobody could tell which was theirs —
  and a caller works one market all day anyway. Null means show everything,
  which is what an admin reviewing both wants.
- Read with `callRegionOf()` in `src/lib/users.ts` — from the database, not the
  session, so an admin changing someone's market takes effect on their next
  page load rather than their next login. `cache()`d, like `countUnreadReplies`.
- **No region labels anywhere.** A caller sees one market's documents, so
  naming it on every row and every drawer open is noise. The only exception is
  someone with no market set, who is seeing more than one market's worth.
- **Markdown is parsed on the server** (`src/lib/sop.ts`, `marked`) and split at
  `##` into sections. The parser never reaches the browser bundle, and the
  drawer needs sections — one per objection — to collapse and search them.
- **Speaker blocks are blockquotes led by a bold label** (`> **You say** …` /
  `> **Prospect** …`); `sop-prose.tsx` tags them `data-speaker` and tints them.
  Plain markdown, so the content files stay hand-editable.
  - **`> **Voicemail only**` is a third label** for words left on a machine: a
    cool tint in a dashed box instead of the warm `You say` block. Callers run
    down the warm blocks reading each one aloud, and the voicemail line looked
    exactly like one. It counts as spoken in `splitSpoken`, and
    `lib/handout.mjs` styles it the same way. **A new label needs all three**:
    the tag in `SopProse`, the tag and CSS in `handout.mjs`, and `isSpoken`.
- **The script sits beside the dial card**, in the column that was empty, and
  is sticky. It is read top to bottom on every call, so it is not behind a tap.
  Below `xl` there is no room for a second column and it becomes a left-hand
  drawer instead. Objections stay collapsible and searchable because you want
  one of fifteen; a script is followed in order, so collapsing it adds taps.
- **The objection drawer is mounted by `Dialler`, never by the lead card.** It
  opens through the shadcn `Sheet`, which renders via a Radix portal — the DOM
  node moves, the React tree does not — so opening it cannot unmount the
  dialler or, once dialling is in the browser, drop a live call. Anything that
  navigates away instead would kill the call. Both regions' sheets are fetched
  once by the page and passed down, because the region follows the current lead
  and that changes client-side.
- The `o` hotkey is ignored while focus is in an input or textarea, or it would
  eat every "o" typed into the notes field.
- **The minimum booking notice is a number in four places and Cal.com owns the
  truth.** The demo event type requires **7 hours** (it was 8 until 2026-09-09).
  Both scripts, `procedure-after-booking.md` and `HowToBook` in `dialler.tsx`
  all state it, and all four said "two hours" for months — which is how a caller
  agreed a slot the calendar would not accept. **If it changes on Cal.com,
  change those four.**
  - It is what blocked the fix on 2026-09-09: a demo agreed for 5:30am Pacific
    could not be rebooked at 22:00 the evening before, because the slot was 7½
    hours out and the rule then demanded 8. The event's availability was never
    the problem, which is worth knowing before anyone goes looking at working
    hours again.
- **Say the time back with AM or PM.** Added to both scripts and the dial card
  after a booking went in twelve hours out: the prospect asked for 5:30 in the
  morning, the caller repeated "5:30 Pacific" three times without ever saying
  which half of the day, and booked the evening. The recording is the evidence
  it was heard correctly and written down wrong. A reschedule on Cal.com creates
  a **new booking with a new uid** and cancels the old, so the CRM shows both
  until the cancelled one's slot passes — that is the sync working, not a bug.
- **The dial card carries the booking procedure, not a checklist** (`HowToBook`
  in `dialler.tsx`, was `QualificationCriteria` until 2026-09-05). It listed the
  three things that make a booking count, which answered the wrong question: a
  caller who has just heard "yes" needs to know what to do next. Both recorded
  demos went wrong on the mechanics rather than the qualification — days offered
  before the calendar was open, the time zone asked for *after* a day had been
  proposed, then most of a minute of silence working it out mid-call. It is now
  seven numbered steps in the order they are done, cut from the script's "Once
  they say yes" section; if that section changes, change this with it.
  - The old criteria are not lost: the first is step 1, because it is something
    you *do* rather than something you have, and all three are restated in one
    line at the foot, which is where the payroll bar belongs.
  - Still hard-coded rather than a document, and still on the card rather than
    behind a tap: what earns a caller their fee must not be scrollable-past or
    editable by accident.

### Slack reporting (post-SOP)

Three things are posted to Slack and `content/sop/procedure-slack-reporting.md`
is the document: daily numbers to `#daily-reports`, a booking to
`#meetings-booked` the moment it is made, and time off by direct message in
advance. Two of the three are prompted in the app by
`src/components/calls/slack-post.tsx`.

- **The templates live in that one component and that one document, nowhere
  else.** A procedure people meet on their first day is one they stop following
  in a fortnight, so the app fills the template in from what it already knows
  and the post becomes a copy and a paste. If a template changes it changes in
  those two files.
- **`DailyReportCard` is on the call lists screen**, which is where a caller
  starts and finishes, rather than on the dialler where they are mid-queue.
  Its numbers come from `getCallTotals` in the person's own `stats_region`,
  which is exactly what the Scoreboard's Today card runs: two ways of counting
  a day would put two numbers in front of one caller, and the one typed into
  Slack had better be the one their pay is read from. The card says which zone
  it used, and renders nothing before the first call of the day, since a card
  reporting zero calls at nine in the morning is furniture rather than a
  reminder.
- **`BookingPostCard` is not a toast.** It appears when `demo_booked` is
  logged and stays until dismissed: the caller goes off to Cal.com to finish
  the booking, so anything that expires in five seconds is gone before they
  come back. It is rendered in the empty state as well as above the lead card,
  because a demo booked on the last lead in the queue is when it matters most
  and is the one path with no card to sit above. The meeting time and the trial
  answer are left blank on purpose: the slot lives on Cal.com and does not
  reach the CRM for a few minutes.
- **Both are `role === "caller"` only**, matching who the SOP asks to post, and
  the same reason founders are off the Scoreboard and off the confirm list.
- **`window.scrollTo` does nothing on any Call CRM screen.** `PageShell` gives
  the page its own `overflow-auto` div, so the window never scrolls and a call
  naming it is silently a no-op. "Up next" in the dialler had one and had
  quietly stopped scrolling anywhere; both call sites now go through
  `backToTop`, which asks the column to `scrollIntoView` and lets the browser
  find the scroller.
- `SopProse` gained `pre` and inline `code` styling for the templates. Wrapped
  (`whitespace-pre-wrap`), never a horizontal scroller: the line breaks in a
  template are its content, and a caller reading this on a phone has to see the
  whole thing.
