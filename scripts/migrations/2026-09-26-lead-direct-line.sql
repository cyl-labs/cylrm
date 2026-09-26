-- The decision maker's own line on a lead (2026-09-26).
--
-- When a gatekeeper hands over the owner's or a partner's cell, the dial card
-- rings it on that lead, so notes, outcome, booking and the recording all land
-- where they belong. Before this the Keypad was the only way to ring it, and
-- the Keypad logs nothing on a lead.
--
-- Apply BEFORE deploying: every calling screen selects these columns, so the
-- new code fails on a database without them. Additive, safe on the old code.
alter table call_lead
  add column if not exists direct_phone text,
  add column if not exists direct_phone_key text,
  add column if not exists direct_name text;

-- Inbound calls and texts look a number up by this. Partial, since nearly
-- every lead has none. Declared in schema.ts too, or drizzle-kit push drops it.
create index if not exists call_lead_direct_phone_key_idx
  on call_lead (direct_phone_key)
  where direct_phone_key is not null;
