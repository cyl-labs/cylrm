-- A founder's own proof that a number is flagged (2026-10-03): a client sent a
-- screenshot of "Potential Spam" on the founders' number. Overrides every
-- guess the Team panel makes. Additive; apply before deploying the code.
alter table call_number add column if not exists spam_seen_at timestamptz;
alter table call_number add column if not exists spam_seen_note text;
