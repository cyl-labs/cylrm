-- Which kind of appointment a booking is.
--
-- The founders book a follow-up call after a demo to walk the prospect through
-- a mock-up. It is a separate Cal.com event type (voice-agent-follow-up) for a
-- reason the CRM cares about: only a demo carries the caller's $30 attendance
-- fee, and `call_demo_attendance` allows exactly one paid attendance per
-- business. A follow-up booked on the demo event type would ask "did they turn
-- up?" a second time and the unique index would refuse the answer.
--
-- Default 'demo' so every booking already synced keeps its meaning. Safe to
-- apply before or after the code: the column is nullable-with-default and the
-- old code never reads it.
alter table call_meeting
  add column if not exists kind text not null default 'demo';
