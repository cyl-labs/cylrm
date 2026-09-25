-- Record calls the prospect places to us (2026-09-25).
--
-- Recording lives on the outbound voice profile, so a ring-back answered in
-- the browser was never recorded, and a demo booked on one had no cold call to
-- play or brief from (Rockin D Roll Offs and Welcome Legacy the same night,
-- both booked on the prospect calling back). The webhook now asks Telnyx to
-- record an inbound call when it is answered. This column is the once-only
-- claim: Telnyx sends call.answered for more than one leg.
--
-- Additive; safe before or after the deploy.
alter table inbound_call
  add column if not exists recording_requested_at timestamptz;
