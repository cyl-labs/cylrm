-- Why each call from one of our numbers ended (2026-10-03), as Telnyx reports it
-- on call.hangup: "call_rejected" with SIP 603 means the far side or its
-- carrier refused the call outright, which is what a spam-flagged number gets.
-- Feeds lib/number-health.ts. Additive; apply before deploying the webhook that
-- writes it.
create table if not exists call_hangup (
  id serial primary key,
  call_leg_id text not null unique,
  call_session_id text,
  from_number text not null,
  to_number text,
  hangup_cause text,
  sip_code text,
  hangup_source text,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists call_hangup_from_created_idx
  on call_hangup (from_number, created_at desc);
