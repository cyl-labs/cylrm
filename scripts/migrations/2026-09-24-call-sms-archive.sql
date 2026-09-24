-- Let a person archive a conversation on the Texts screen.
--
-- Per person, like read receipts: archiving tidies your own list and nobody
-- else's, so a founder putting away a caller's thread does not hide it from
-- the caller who has to answer it.
--
-- A row is the moment it was archived, not a flag. A conversation counts as
-- archived only while nothing has arrived since, so a prospect texting again
-- brings it straight back to the list rather than into a folder nobody opens.
--
-- Additive, but apply it before the code: the Texts screen reads this table
-- and returns 500 without it.

create table if not exists call_sms_archive (
  id serial primary key,
  user_id integer not null references app_user(id),
  their_number text not null,
  our_number text not null,
  archived_at timestamptz not null default now()
);

create unique index if not exists call_sms_archive_key_idx
  on call_sms_archive (user_id, their_number, our_number);
