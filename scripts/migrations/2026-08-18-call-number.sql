-- Which Telnyx numbers may be used for cold calling.
--
-- The account holds numbers that answer for clients' voice agents. They are
-- perfectly valid caller IDs and Telnyx would let one be used, but a prospect
-- ringing back would reach a client's agent, so they should not be on offer at
-- all rather than merely discouraged.
--
-- A row per number, only for the ones deliberately taken out of the pool.
-- Absent means available, so a number bought tomorrow is usable without anyone
-- remembering to add it here.
--
-- Safe to re-run.

begin;

create table if not exists call_number (
  phone_number text primary key,
  available boolean not null default true,
  updated_at timestamptz not null default now()
);

commit;
