# Telnyx browser dialling (Call CRM)

Part of the cylrm project notes — the always-loaded core is `AGENTS.md`,
and the product spec is `BLUEPRINT.md`.

Being built. Only the three Nigerian callers need it — the UK/US pair keep
dialling from their own handsets, which is what the copy-to-clipboard button has
always been for.

Account resources created 2026-08-17, both **dedicated to this app** so nothing
else on the droplet's Telnyx account is affected:

- Credential connection **`cylrm-dialler`** = `3028596445818127404`. A *credential*
  connection is the only kind a WebRTC softphone can register against; the
  pre-existing "Forward Only" was left alone, and the other two connections are
  `elevenlabs` and `portal-conference-bridge`.
- Outbound voice profile **`cylrm-dialler`** = `3028597272247010421`, recording
  `all`, mp3, **dual channel**, destinations `SG`/`US`. (It was created single
  and changed to dual for speaker-labelled transcripts; this line said single
  until 2026-08-24, which is worth knowing because it is the reason a recording
  plays with the caller in one ear and the prospect in the other.)

**Recording is configured on the outbound voice profile, not on the connection** —
there is no recording field anywhere on a credential connection. This matters
because a profile is shared by every connection attached to it: the existing
`cyllabs` profile had four, so switching recording on there would have started
recording the conference bridge and the email CTA too. Hence a profile of its
own. `whitelisted_destinations` on that profile is also what decides which
countries can be rung at all — UK is deliberately absent.

Env (all optional; unset means no dial button and every other calling screen
behaves exactly as before): `TELNYX_API_KEY`, `TELNYX_CONNECTION_ID`,
`TELNYX_PUBLIC_KEY` (Ed25519 webhook key, `GET /v2/public_key` — the webhook
route refuses everything when it is unset).

**Caller ID is per person, not per market, and lives in the database rather
than the environment.** `TELNYX_DID_SG` / `_US` / `_GB` are gone: a number is
assigned to a caller on the Team screen (`app_user.telnyx_did`, picked from
`call_number`, with `call_did` holding the per-market fallbacks that predate
it), and `getDids` returns that one number under every country key. It started
as a per-market layer a caller with no number fell back to, which meant the
caller ID on a given call came from two places and neither was visible on the
screen. Someone with no number gets a disabled dial button saying so, never
somebody else's. As of 2026-08-24 four accounts have one; `dial_method`
(`browser` | `handset`, not `dial_mode`) says who dials in the browser at all.
The dropdown offers **that person's market's numbers**, since a US number
ringing Singapore leads is worse than sharing a Singapore one — except for
someone with **no market**, who is offered every free number, because no market
means every market. Until 2026-08-28 they were offered nothing at all, which
left the founders' account — the one account deliberately tied to no market —
looking as though the business owned a single number: the API never had that
restriction (`region && !did.startsWith(prefix)`), only the dropdown did.

**Every screen that can dial must claim the line** (2026-09-20). The election
in `line-presence.tsx` gives a tab with a *calling* screen priority over one
that is merely listening, which is what stops a forgotten tab keeping the
phone — but only the dial card and the Keypad ever called `useClaimLine`.
Meetings, Missed calls and Texts all dial and none of them claimed, so they
registered at listening priority like any other tab and could lose the
election to one sitting on Scripts. The symptom is the row saying "the phone
is open in another CRM tab. Dial from there" while the tab it names cannot
dial at all, which is unfalsifiable from the outside and reads as the phone
being broken. All three claim now, gated on `canDial` so a handset caller
registers nothing to fight over. **A new screen that dials has to claim it
too** — there is no way to derive this, and the failure is silent.

**A number somebody already holds is labelled, never hidden** (2026-09-07).
`available` on that dropdown is the *reserved* flag from the numbers panel, not
an assignment, so a number already being somebody's caller ID was offered with
nothing saying so — handing one out twice took a single click and left no
trace. That is exactly how the founders' account and a caller shared a number
for a fortnight: both dialled out from it, and inbound calls to it rang
whichever of the two `recordInbound`'s `where telnyx_did = $to and active limit
1` returned first, which is unordered. `holderOf` in `team-manager.tsx` now
prints "in use by <name>" on the item, `offerFor` sorts free numbers to the
top, and picking a taken one asks first and says what breaks. Still allowed —
a demo line two people dial from is a real thing to want — just never by
accident. `telnyx-numbers.tsx` names **every** holder (`holders`, not `find`)
and colours a shared row red, so an existing collision is findable at a glance
rather than hidden behind whichever name `find` happened to return.

**Reserve must never be a one-way door** (fixed 2026-09-16). That button was
`disabled={!n.available && !!who}` — refusing "Make available" while somebody
held the number, tooltip "Unassign it from that person first." The guard was on
the wrong side: reserving an assigned number is the questionable act,
un-reserving it is purely additive, so one mis-click locked the undo behind
unassigning a caller. A founder hit it and could not get back. Making a number
available again changes nothing about who holds it or what Telnyx does; it only
lets it appear as an option, and `offerFor` already labels a held one "in use
by <name>" and asks before handing it out twice.

**Assigning a number does not clear the previous holder.** `PATCH
/api/users/[id]` sets `telnyxDid` on the target and calls `provisionLine`,
which repoints the number at *that person's* connection — but it leaves the old
row claiming it. Moving a number between people is therefore two calls, clear
then assign, in that order: skip the first and inbound rings the new holder
while the old one still dials out from a number that is no longer theirs, which
is the shared-number failure above arrived at by a different road.

**A number needs a connection, not just a DID.** Buying one and setting
`telnyx_did` gets outbound working and leaves the person unreachable: inbound
rings whatever is registered on the *connection* the number points at. The full
wiring for a new number is three steps — create a credential connection
(`cylrm-<name>`), point the number at it, then set `telnyx_connection_id` and
`telnyx_did` on the person **while clearing `telnyx_credential_id`**. Copy the
connection's settings off an existing one: the webhook URL is what carries
recordings back, and `outbound_voice_profile_id` is where recording and the
SG/US destination whitelist live. As of 2026-09-14 eight accounts have a number,
each on its own connection (`cylrm-mico` and `cylrm-querla` added that day,
copied field for field off `cylrm-harry`, numbers on the `cylrm-sms` texting
profile too), and no number is held by two active people. **A connection is not
enough to be rung:** the browser has to log in as the connection's SIP user,
because a token-only browser answers an inbound call SIP 480 (see
`mintCallToken`). Until 2026-09-15 that was opt-in per person through
`TELNYX_SIP_LOGIN_USERS`, which held only Harry and Maryjane for most of its
life, so every call to anyone else's number went straight to Missed calls. It is
now the default for anybody with a line of their own, the founders' account
included, and the env list is no longer read — see **Adding and replacing
people** for that and for how lines are now built from Team.

A JWT's `exp` is exactly its parent credential's `expires_at`, so any token cache
must expire at `min(cacheTtl, credentialExpiresAt)` — caching a token minted late
in a credential's life for a flat period hands out one that is already dead.

**Recordings and transcripts.** Audio lives in Telnyx's own S3; the CRM stores
only `recording_id` and timing in `call_recording`, never a URL — the ones in
the webhook are presigned and expire in ten minutes, so `/api/recordings/[id]`
mints a fresh one per play. That is why a recording opened a month later still
works. Nothing deletes them: `DELETE /v2/recordings/{id}` is the lever if a
retention policy is ever wanted.

**Each recording also stores who the call was between** (`to_number`,
`from_number`), which is how audio that no `call` row points at is found:
the demo call on a Meetings row, and a lead's recordings on the Spreadsheet.
**The `call.recording.saved` webhook does not carry the numbers.** The route
read `p.to` from 2026-09-16 and stored nothing on any recording for a day and
a half (362 rows, found on 2026-09-18 when a caller's Keypad calls would not
show up on his leads). It now fetches them from `GET /v2/recordings/{id}`
(`recordingNumbers`) when the payload has none, best effort, and
`scripts/backfill-recording-numbers.mjs --write` filled the gap; every row on
prod has numbers. If new recordings start arriving blank again, run that
script and check the webhook's log for "could not fetch recording numbers".

The outbound voice profile records **dual-channel** — caller on one track, the
prospect on the other — so a transcript's speaker labels come from which track
the audio is on rather than from diarisation guessing over a noisy line. It
must stay dual: single-channel recordings cannot be relabelled afterwards.
`POST /api/recordings/[id]/transcribe` sends a fresh URL to Deepgram
(`multichannel` + `utterances`) and stores the result on the recording row, so
the first person to open a call pays for it and everyone after reads it free.
On demand rather than on every dial, because it is billed per minute and these
are read a handful of times a week to settle a commission. Unset
`DEEPGRAM_API_KEY` means the button reports it and nothing else changes.
`CALLER_CHANNEL` in `src/lib/deepgram.ts` assumes Telnyx puts the originating
leg on channel 0. **Confirmed correct on 2026-08-24** against the first two
real transcripts: the prospect answers "Hello?" and the caller opens with the
qualifying question, which is the right way round. If it ever comes out swapped
that constant is still the only thing to change.

Transcripts are read back through the recording sheet, which loads whatever is
already stored when it opens — a `GET` on the transcribe route that never
reaches Deepgram, kept apart from the `POST` that does. Clicking a turn seeks
the audio to it, and the turn being spoken is lit while it plays.

**Conferencing a third party in is done in the browser, not by Telnyx.** The
Keypad can dial a second number alongside a live call and join the two ("Add
call" → "Merge calls"), which is how a prospect hears the AI demo line on the
spot instead of being asked to ring it themselves after the call. Telnyx will
conference legs server-side, but only for calls placed through a Call Control
application: this app dials from a *credential* connection — the only kind a
WebRTC softphone can register against — and `third_party_control_enabled` is
false on `cylrm-dialler`, so those legs are not addressable by the commands
that would build a conference. Going that way means a new Call Control app, a
second webhook flow and the caller ID moving, so the bridge is instead in
`src/components/calls/audio-bridge.ts`: one `getUserMedia` feeds both legs,
each leg is *also* sent the other's incoming audio (and never its own), and
`RTCRtpSender.replaceTrack` swaps what a live sender carries without touching
the SDP, so neither far end sees anything happen.

- **The tab is the bridge** — closing it drops both calls, and the screen says
  so once there are two.
- **Before the merge the first call is on a local hold**: microphone muted,
  earpiece turned to zero. Not a SIP hold, because nothing should be
  renegotiated for the ten seconds it takes to dial the second number. Volume
  rather than `muted` on the audio element: Chrome only pumps a remote stream
  into Web Audio while it is attached to a *playing* element, and the bridge
  taps that same stream a moment later.
- **Merge is pressable while the second call is still ringing** and fires on
  answer. A voice agent starts talking the moment it picks up, so waiting for
  the answer to press it loses the opening.
- **The add step lists the lines worth a button**: numbers on the account that
  carry a `call_number.label` and are on nobody's `app_user.telnyx_did`. A
  label is what makes a number nameable — "pxn junk removal" is a demo line
  somebody rings on purpose — and an assigned number is a caller's own caller
  ID, so dialling it rings a colleague. They ring on the tap, no confirm: the
  number was labelled by hand and the label already says everything there is to
  check. `available` is deliberately not consulted; it governs the caller-ID
  picker on Team, and a demo line taken *out* of that pool is exactly what
  belongs here. Labels are typed on Team, so a new demo line needs no deploy.
- Recording is unchanged and still per-leg, so a merged call is two recordings,
  and the caller's channel on each now carries the other party as well.
- `useTelnyxCall` runs both calls on the one client and one SIP registration.
  Both report through the same notification handler, told apart by asking
  whether each update is the *first* call — the second has no identity yet when
  its earliest updates arrive. Ending the first ends both, since whoever was
  brought in was brought in to speak to that prospect.
- **The dialler has it too**, on a live lead call: the same "Add call", the
  same list, the same merge. What the two screens share lives in
  `components/calls/second-line.tsx` (`LinePair`, `MergeControls`,
  `SavedLineList`) so the hold and the merge cannot drift into two behaviours a
  caller has to learn twice. The lead's own row reads by company rather than by
  number, which is the one thing the Keypad cannot do.
  Two differences, both deliberate: there is **no number entry** on that card —
  no pad to type into, so the labelled list is the whole feature and the button
  is absent when nothing is labelled, rather than opening onto an empty list —
  and `DialControls` is keyed on whether a call is up, so an open list cannot
  survive into the next lead's call. Anything you want to be able to conference
  from a lead call therefore needs a label on Team; that is the switch.
- **Live-verified only as far as two real calls can be placed from one browser**
  — the layouts and the state machine are checked, the mixed audio itself needs
  two handsets and a demo line to hear.

### The line lives in the layout, so a call survives a page change

`CallLineProvider` (`components/calls/call-line.tsx`) is mounted in
`(app)/layout.tsx` and owns the one `useTelnyxCall` for the whole app. The
dialler, the Keypad and `InboundListener` all consume it through `useCallLine()`.

- **Why it moved (2026-09-08).** The dialler and the Keypad each mounted their
  own line, and a client navigation unmounts a page — so the hook's cleanup hung
  up. Inbound was never affected, because that listener has always been in the
  layout: a layout survives route changes and a page does not, which is the
  whole fix. What it cost in practice was worse than the bug sounds: a caller
  ringing a callback copied the number onto the Keypad (no dial button on the
  diary), talked to a business whose name was not on the screen, and dropped the
  call by navigating back to log the outcome.
- **`useClaimLine` no longer decides who holds the line — only who draws it.**
  There is one registration now, so the flag exists to stop the layout's banner
  and call bar rendering on top of a screen showing its own. Do not read it as
  "this screen owns the phone" again. The cross-tab election in
  `line-presence.tsx` is untouched and still the thing that stops two SIP
  registrations forking one invite.
- **The Keypad's leg logging moved into the provider**, and that is load-bearing
  rather than tidy: a `keypad_call` row is written when a leg *ends*, and a call
  now outlives the screen it was placed from. Left in the Keypad, navigating
  away mid-call would have filed a truncated duration and then never filed the
  real one. The Keypad hands the leg over at dial time (`startLeg`).
- **`activeLeadId` is why an outcome cannot land on the wrong business.**
  Returning to the dialler mid-call re-mounts it with no memory of which lead
  was picked, so it opened on the top of the queue — a different prospect — while
  the caller was still talking to the last one. The provider remembers whose
  call is up and the dial card opens on them; it beats `?lead=` for the same
  reason.
- **A call on a non-calling screen gets a bar** (bottom centre: timer, mute,
  hang up). Without it, surviving navigation would mean a live call with no way
  to end it short of finding the way back.
- One pair of `<audio>` elements for the app, in the provider. Each screen had
  its own only because each held its own line.
- **Verified structurally, not on a live call**: the provider's instance is
  identical across navigations to Callbacks, Meetings, Keypad and Call lists,
  and remounts on a full reload. The audio path, hold and merge still want a
  real call through two handsets. Rollback point is the tag
  `pre-call-provider`.

### A call the network refuses says so (2026-09-17)

`CallEnd` / `ended` on `useTelnyxCall`, turned into words by `callFailure`
(`components/calls/call-failure.ts`), shown above the dial card's button.

- **Why.** A number that does not exist is refused with SIP 404 in under a
  second, before anything rings, and the card went straight back to its Call
  button. That reads as the button doing nothing. On 2026-09-16 Omar pressed
  Call on Trash Panda's +17132272632 **twenty times in 48 minutes** (19:43 to
  20:31 UTC), every one `not_found` / 404, and reported that the CRM would not
  let him ring a business he had called before. The business's other number
  had connected at 19:36. He finally logged it as No answer, when it was a
  Bad number.
- **How it was found, since this is the next person's route too.** The
  webhook logs have no timestamps, but Telnyx session ids are version 1 UUIDs
  with the time inside them. Decoding the sessions in `crm-out.log` showed
  bursts of `call.initiated` with no `call.bridged`, three or four within ten
  seconds, which is somebody pressing a button again and again.
  `GET /v2/call_events?filter[leg_id]=…` then gives `to`, `from` and the hangup
  cause per leg. **`filter[call_session_id]` is silently ignored** and returns
  the account's recent events instead, which looks like an answer.
- **Only the far end's hangup counts.** The SDK copies `cause`, `causeCode`,
  `sipCode` and `sipReason` off Telnyx's bye before it announces the hangup
  state. Our own hangup sends none, and the SDK then *defaults* the cause to
  `USER_BUSY` for any call not yet answered. So busy is only believed with a
  486/600 behind it, and `hangup()` marks the call as ours.
- **What it says.** 404/410/484/604 or an unallocated-number cause: "This
  number does not exist", log it as Bad number, and the button reads Try again
  in the outline style. Busy and declined: log it as No answer. Anything else
  that ended before ringing, with a 4xx or inside five seconds: did not go
  through, try once more. A call that rang, was answered, or that we hung up
  says nothing.
- **Keyed on the lead.** The card shows it only when `lastLeadId` is this
  lead, and `reset()` (called after logging) clears it, so the warning does not
  follow the caller to the next card.
- **Also fixed in passing:** when `callRef.current.hangup()` threw, `hangup()`
  went back to idle but kept the dead call, and `dial()` returns early while a
  call is held. That was a Call button that silently did nothing until a
  reload. Not what Omar hit, as the 404s show his presses reached Telnyx.
- **Verified on the logic, not on a live call.** `callFailure` was checked
  against the recorded 404 and the ordinary endings. The bye fields are read
  from the SDK source (2.27.9), not observed in a browser.

### A dead line says so, and comes back on its own (2026-09-19)

`DialControls` in `components/calls/dialler.tsx`, and the connect effect in
`use-telnyx-call.ts`. Three faults in the same path, each of which alone hides
the Call button for the rest of a shift.

- **Why.** Alex, 2026-09-18: *"its not giving me a call back option — when i do
  call back, call doesn't start"*. He had promised J&J Junk Removal a ring back
  at 4pm their time (a real 117-second call, notes "seems interested"). The
  callback fell due at 20:00 UTC; **his next call was at 21:01, and it was a
  `no_answer` on that lead with no Telnyx session and no duration** — a call
  that never happened. Ninety minutes of a shift, one broken promise, and a
  warm lead now reading as no-answer in the record. He was not being careless:
  with the phone gone, the work gate above the card says *"logging an outcome
  is what clears one, and No answer counts"*, so **the screen itself points at
  the fake log**. This is the lockout `docs/cold-calling.md` warned would
  appear the moment a stage gained a state its owner cannot clear.
- **The dial card rendered nothing at all.** `if (line.problem || (!line.ready
  && !busy)) return null` — no button, no reason, no way out, leaving only the
  orange copy-number button. Every neighbouring branch in that component
  explains itself (*"The phone is open in another CRM tab"*, *"Dial it on your
  handset"*), and the comment two lines above it says why: an unexplained
  missing dial button reads as the phone being broken. **The Keypad showed
  `line.problem` all along; the dialler was the one screen that threw it away,
  and it is the screen the floor works in.**
- **`problem` was write-once.** `setProblem` was never called with null, so a
  line that failed and then *succeeded* on the retry ladder still read as
  broken for the life of the page — and since the card hid its button while it
  was set, the phone worked and the only screen that dials from it did not.
  Cleared on `telnyx.ready` now.
- **A failed token fetch never retried.** `telnyx.error` has had a four-try
  ladder (2s, 5s, 12s) since the credential-activation fix; a non-OK
  `POST /api/telnyx/token` returned immediately and stayed dead. That is
  exactly the deploy case already documented in `AGENTS.md` — a restart 502s
  that route for the seconds the app takes to come back. It now takes the same
  ladder. Measured after the fix: four attempts at +1.2s, +3.8s, +9.7s, +22.5s.
- **The caller is not shown the provider's sentence.** `/api/telnyx/token`
  hands back the raw `err.message` ("The API key looks malformed…"), which is
  a developer's line about API keys. Logged in full to the console, shown as
  "Calling is unavailable." — the rule the `telnyx.error` branch beside it
  already followed.
- **Replicated before it was touched**, with a local dev server holding an
  invalid `TELNYX_API_KEY`, a caller whose callback fell due an hour ago, and
  Playwright: the card came back with the copy button, the outcome buttons and
  no Call button, matching Alex's screenshot line for line. Re-run after the
  fix at 390px and 900px, no horizontal overflow.
- **How often this bites.** 161 outcomes in the fortnight to 2026-09-19 were
  logged by browser callers with no Telnyx session, in clusters that look like
  a phone dropping: Gigi 16 of 25 on 18 Sep, Mico 31 of 80 on 16 Sep, Brian 18
  of 87 on 17 Sep. **Not all of those are fake calls** — the Spreadsheet, the
  Pipeline, the callbacks diary and clearing a missed call all log an outcome
  without dialling, which is why `admin` shows 160 sessionless rows and zero
  real ones. A cluster inside a dialling run is the shape to look for.

Not built and not optional before volume dialling: a recorded-line announcement
in the opener (recording is per-profile, so there is no per-call toggle and no
beep), a retention period, and Singapore DNC scrubbing.

### Telnyx dropped 34 recordings and nothing noticed (2026-09-22)

`lib/recording-gaps.ts`, `POST /api/cron/recordings`, table
`call_recording_gap` (`2026-09-22-recording-gap.sql`, **applied before the
deploy**), alert in `notifyRecordingGap`.

On 2026-09-21, between 20:08 and 23:24 UTC, **34 answered calls on
`cylrm-aaron` captured their audio in full and never published it** — 2,008
seconds, including the call that booked the Wallworth demo. Telnyx confirmed
it: the media server wrote the file (`RECORD_STOP`, cause success, 9,105,408
bytes on the longest), and the publish step — transfer to storage,
registration in the recordings library, `call.recording.saved` webhook — never
ran. They correlated the failures to their `lv1` processing site while the
successes on the same connection went through `sv1`.

- **It was invisible from our side by construction.** `call.hangup` arrived,
  the duration was right, the invoice was right. The only symptom was an
  absence, and nothing was checking for one — it surfaced three days later
  when somebody opened a demo briefing and found it blank.
- **There is no `recording.failed` webhook**, confirmed by Telnyx. Absence is
  the only thing that can be detected, so the sweep runs on **every** worker
  tick and reports the moment it finds something — unlike the callbacks, quota
  and payroll digests beside it, which describe a day that is over. This
  describes a fault that may still be running.
- **One row per call, unique on `call_id`.** The insert *is* the claim
  (`on conflict do nothing … returning`), so the tick that finds a gap is the
  only one that reports it and two racing ticks cannot both announce it. Same
  shape the payroll reminder uses to make a weekly job safe on a five-minute
  loop. The row stays afterwards as the record of what was lost.
- **Ten minutes of grace, 48 hours of lookback.** Telnyx publishes in about a
  second and our webhook lands on top of that, so ten minutes is far beyond
  both: the cost of waiting is a late alert, the cost of not waiting is crying
  wolf until somebody mutes it. The lookback stops a restored backup
  announcing a month of history.
- **A call that never connected is not a fault** — no audio to lose. That is
  `duration_seconds > 0`, and it matters: 10 of Aaron's 44 unrecorded calls
  that day were never answered.
- **The table is seeded with everything already missing** (78 rows, marked
  notified) so the first live tick reports only what is new. Announcing
  Sunday's calls in a message that means "something is wrong right now" would
  have taught everyone to ignore it on day one.
- The alert **names the caller**, because a gap is far more often one line
  than a global outage: that day one connection lost calls while eight others
  recorded normally.
- **"Connected" is Telnyx's word, not the browser's** (2026-09-24). The first
  four live alerts, one night, were all false: Harry ×2, Aaron, Akshansh, and
  Telnyx billed every one at **0 seconds** (`USER_BUSY`, `UNALLOCATED_NUMBER`,
  `DECLINE`, `ORIGINATOR_CANCEL`). `duration_seconds` is the browser's timer,
  and `dial` never reset it — the timer restarts only on answer — so a call
  nobody picked up posted the previous call's length (Aaron's "85s" was the
  86s call before it). `dial` now zeroes it, and the sweep asks
  `callConnected` (`detail_records`, `connected` / `call_sec`) before
  claiming; a call Telnyx says was unanswered gets its duration set to 0,
  which is the truth and drops it from the sweep for good. No record, or an
  API failure, still alerts. Akshansh's also showed a second shape: a real
  recorded conversation, then a cancelled redial of the same prospect, then
  the outcome — which lands on the redial's session, leaving the recording
  unattached. That call was relinked by hand; the dialler still does it.
- **Counting these needs every page of `detail_records`.** `page[size]` caps
  at **50** whatever you ask for, and there were 168 pages for one week — a
  six-page fetch gave 33, then 30, then 27 for the same question, because
  which sessions it happened to contain kept changing. Page to
  `meta.total_pages` or the number is fiction.

### Incoming calls rang with no banner on Meetings, Texts and Missed calls (2026-09-24)

`useDrawsIncoming` / `useIncomingDrawn` in `line-presence.tsx`. The app-wide
banner in `InboundListener` stood down whenever the tab was `claimed`, which
once meant "the dialler or the Keypad is open", both of which draw their own
banner. Meetings, Texts and Missed calls later started claiming the line so
the tab election would keep the phone in them, and none of them draws a
ringing call. So on those three screens a call rang (the tone comes from
`CallLineProvider`) with nothing on screen to answer it, and went to Missed
calls. Found from a prospect ringing back ten seconds after a dropped demo: 14s
of ringing, SIP 487 when they gave up, the founder on Meetings. Claiming the
line and drawing the ring are now separate questions; only the dialler and the
Keypad set the second. The ongoing-call bar still follows `claimed`.

### Clicking another CRM tab hung up the call (2026-09-24)

`ON_CALL` and `useReportCall` in `line-presence.tsx`, reported from
`CallLineProvider`. The tab election ranked a hidden tab below a visible one
*within* each tier, so a tab mid-call that was put behind another tab showing
any screen that can dial (Meetings, Texts, Missed calls, the Keypad, the
dialler) lost the line — and losing it tears down the registration, which
hangs up the call. The founders' demo with Next Level Haul Away dropped four
times in twenty minutes, each cut mid-sentence at the moment the contract was
being sent from the other tab ("I've sent a new link… it should be the exact
same document"); Telnyx logged every one as `recv_bye` from the browser.
"Sometimes", because a tab on a screen that cannot dial ranks too low to take
it. A tab with a call, a second leg or a call ringing in now outranks every
other tab, visible or not, until it is idle.

### Two tabs made the Call back button strobe (2026-09-22)

Reported as the button "constantly flashing between Connecting… and Call back",
by a caller working two tabs — copying a prospect's details out of one to log
the call in the other. Two bugs compounding, and both are fixed.

- **`line-presence.tsx` decided the election purely on a 1s heartbeat with a
  3.5s stale timeout, and browsers throttle timers in hidden tabs** — Chrome to
  about once a second, and to once a *minute* after five minutes hidden. The
  backgrounded tab stopped beating, the other declared it dead inside 3.5s and
  took the line, and the flip reversed whenever a throttled beat landed. In the
  gap, **both tabs held a registration** — the exact state that file exists to
  prevent, and which Telnyx answers by knocking one off.
  - Fixed by ranking a hidden tab **below** a visible one, so the visible tab
    wins on priority rather than on whether a throttled timer happened to fire.
  - **Visibility is a tier inside each class, not an override**, and the first
    attempt got this wrong: it demoted only tabs with `holders === 0`, which
    does nothing on the screens where it bites. `holders > 0` means "a screen
    that can dial is mounted" — Meetings, Texts, Missed calls, the Keypad and
    the dialler, so most of the Call CRM. The four ranks are
    `CALLING_VISIBLE` > `CALLING_HIDDEN` > `LISTENING_VISIBLE` >
    `LISTENING_HIDDEN`. A dialler tab still outranks a listening one even when
    hidden, so switching apps mid-call cannot hand the line away.
  - A priority change now **elects as well as announces**. Telling the other
    tabs is half a handover; the tab that has just been hidden has to stand
    down itself, and its own beat is precisely the throttled timer.
- **`use-telnyx-call.ts` retried a dropped line at a flat 2 seconds, forever.**
  Right for the case it was written for the same day — a socket that dies
  quietly and refuses every inbound call until somebody reloads — and wrong for
  any cause that is still there when you come back: two tabs evicting each
  other every two seconds is what turns that into a strobe. `RECONNECT_BACKOFF_MS`
  now escalates 2s → 5s → 12s → 30s → 60s, and a line that held for
  `STABLE_MS` (30s) before dropping resets to the fast retry, so a genuine
  one-off outage still comes back as quickly as it did.

**Verified by driving the handover**, not by reading it: two tabs against a
local instance with `document.visibilityState` stubbed, using the
`/api/presence` heartbeat as the signal for which tab holds the line — it is
gated on the same flag and beats every 15s forever, where the token ladder
gives up after three tries and stops being an observable. Hiding the holder
moves the line, showing it moves it back, and both hidden still leaves exactly
one. **Do not test this against prod Telnyx**: an early attempt pointed a local
dev server at a real DID and registered a live SIP session on the shared
connection. It created a `cylrm:devadmin` credential, which was deleted; it
reached no caller's own connection, but the next one might. Point
`TELNYX_API_BASE` somewhere dead instead.

### A recording with no call to sit on (2026-09-20)

`/api/calls` resolves a session server-side when the browser sends none, and
`scripts/relink-recordings.mjs` did the ones already lost.

- **Why.** Asked as "why is there no call recording" on a booked demo. Aaron
  rang Garbage Removal LLc for **4m53s** at 17:08, the prospect booked on
  Cal.com at 17:17, and he logged `demo_booked` at 17:22 — and that row saved
  with no `telnyx_session_id`, which is the only thing `call_recording` joins
  on. The audio existed the whole time and belonged to nobody.
- **It is not a caller logging badly, and saying so matters.** A recording only
  exists if the call went through Telnyx, so these are real conversations with
  real durations. Tell them apart: *no recording and no session* is an outcome
  logged without a call being placed (see the missing dial button, 2026-09-19);
  *a recording and no session* is the app losing the link to a call that
  plainly happened. **223 recordings in a fortnight had no call attached, and
  36 of them lined up with one exactly.**
- **How the link goes missing.** `line.sessionId` is live state, gone the
  instant a call ends, so the dialler remembers the last finished call per lead
  and hands it back at save time. A page load between hanging up and logging
  loses that memory. Fourteen minutes and a reload is exactly Aaron's gap.
- **Resolved on the server, not patched into every read.** The save looks for a
  recording on the same prospect number, from that caller's own `telnyx_did`,
  started within the half hour, and **attached to no other call**. All four,
  because the cost of guessing is one person's conversation on another
  person's row. Writing the id onto the row means every screen that already
  joins on it — the call log, the lead's recordings, the meeting card — needs
  no change at all.
  - Only on the null path, so a browser that did its job is never
    second-guessed, and finding nothing is the ordinary case: a handset call
    has no recording and neither has a no-answer.
  - **The longest wins** where a call has several, the rule `meetingSelect`
    already uses. A six-second redial is not the conversation.
- **The backfill refuses ambiguity rather than guessing it.** One recording
  matching two calls is left alone and printed; one call matching two
  recordings takes the longest, which is a different question — there the call
  is certain. Four were left alone across the fortnight.
- Verified both ways: an outcome posted with no session id came back carrying
  the right recording rather than a longer decoy to another number, and a
  second outcome on the same lead took none, the recording being claimed.
- **The cause is fixed too, and it was one line of scope** (2026-09-20). The
  finished call was remembered in a React ref and nowhere else, so the single
  thing guaranteed to lose it was the thing callers do constantly: loading a
  page. It is written to `sessionStorage` as well now (`cylrm-last-call`) and
  `sessionFor` falls back to it, so a reload between hanging up and logging
  keeps the session.
  - **`sessionStorage`, not `localStorage`**: per tab and gone when the tab
    closes, which is the life of a shift and the same scope the line has. The
    two-hour `SESSION_MEMORY_MS` window still applies on read, so this morning's
    call cannot attach to this afternoon's outcome.
  - Both reads and writes are wrapped: storage throws in a private window and
    with site data switched off, and a dialler that cannot write itself a note
    must still place calls. The ref alone then behaves exactly as before.
  - Written on every tick the call is live rather than once at the end, since
    nothing tells this component which frame was the last of a call.
  - Verified through the dial card: set the memory, reload, log an outcome —
    the browser sent `telnyxSessionId` and the duration, both of which were
    absent before.
