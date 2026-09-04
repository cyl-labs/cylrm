-- Inbound calls, so a missed one is not simply gone.
--
-- Nothing recorded a call arriving until now. A prospect ringing back reached
-- a browser if one happened to be open and vanished if it was not, and even an
-- answered one left no trace: `call` belongs to the outbound cold-calling
-- system, is keyed to a `call_lead`, and its outcome vocabulary describes a
-- call somebody chose to make. An inbound call is neither of those things.
--
-- Written by the Telnyx webhook rather than by the browser, which is the whole
-- point: a call that rang out while the CRM was closed is exactly the one
-- worth knowing about, and no browser was there to report it. The webhook sees
-- every leg regardless.
--
-- Apply BEFORE deploying the code. `countMissedCalls` is called by the app
-- layout to draw the sidebar badge, so a missing table is not a broken Missed
-- calls screen — it is every screen in the app returning 500. The same
-- ordering `2026-08-30-call-meeting.sql` needed, and for the same reason.

create table if not exists inbound_call (
  id serial primary key,

  -- One row per call, not per leg. Telnyx forks an invite and emits
  -- `call.initiated` several times for one ringing phone; keying on the
  -- session collapses those into the single call a person experienced.
  call_session_id text not null unique,

  from_number text not null,
  to_number text not null,

  -- Whose number was rung, resolved from `to_number` against
  -- `app_user.telnyx_did`. Null when it matches nobody, which is worth keeping
  -- rather than dropping: a call to a number nobody owns is a misconfiguration
  -- that should be visible to an admin.
  user_id integer references app_user(id),

  -- The lead this number belongs to, when it is one we have called. Null is
  -- ordinary — anybody can ring a business number.
  call_lead_id integer references call_lead(id),

  started_at timestamptz not null default now(),
  -- Null means it was never picked up. That is the definition of missed, and
  -- it is derived rather than stored as a flag so a late `call.answered`
  -- cannot leave a row disagreeing with itself.
  answered_at timestamptz,
  ended_at timestamptz,

  -- Rung back, or otherwise dealt with. Set by hand: deriving it from a later
  -- outgoing call would work only for numbers that match a lead, and the ones
  -- that do not are precisely the calls most likely to be forgotten.
  handled_at timestamptz,
  handled_by integer references app_user(id)
);

create index if not exists inbound_call_user_idx on inbound_call (user_id);
create index if not exists inbound_call_started_idx on inbound_call (started_at desc);
-- The badge's query, which runs on every page render for every signed-in
-- person. Partial, because it only ever asks about this one slice.
create index if not exists inbound_call_outstanding_idx
  on inbound_call (user_id)
  where answered_at is null and handled_at is null;
