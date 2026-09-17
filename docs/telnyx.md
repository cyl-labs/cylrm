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

Not built and not optional before volume dialling: a recorded-line announcement
in the opener (recording is per-profile, so there is no per-call toggle and no
beep), a retention period, and Singapore DNC scrubbing.
