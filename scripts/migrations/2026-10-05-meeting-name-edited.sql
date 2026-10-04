-- A meeting's contact name corrected by hand (2026-10-05). The Cal.com sync
-- copies the booking's name over on every tick, so a correction needs a flag the
-- sync respects; without it the typo comes back within five minutes. Additive;
-- apply before deploying the code.
alter table call_meeting add column if not exists attendee_name_edited boolean not null default false;
