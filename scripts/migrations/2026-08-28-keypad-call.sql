-- Every number dialled from the Keypad, so the call history can show it.
--
-- Apply BEFORE deploying the code that reads it: the Stats call log selects
-- from this table, so deploying first turns /call-stats into a 500.
--
--   docker exec -i cylrm-db psql -U cylrm -d cylrm < this-file.sql
--
-- The Keypad wrote nothing at all until now, deliberately: it is a phone with
-- no lead behind it, and a `call` row would have put test dials into Stats, the
-- board, the Scoreboard and a caller's pickup count. That reasoning is about
-- the *numbers*, not about the record — "who rang that number on Tuesday" had
-- no answer anywhere, and neither did "play me that recording", even though
-- Telnyx had saved one.
--
-- So: its own table, with no foreign key into `call_lead` and nothing joining
-- it to `call`. It cannot reach a lead's state or an aggregate, because there
-- is no path from here to either. The only reader is the "Every call" table on
-- Stats, which unions it in and marks the rows Keypad; every tile, chart and
-- payroll figure still counts `call` alone.
--
-- Safe to re-run.

begin;

create table if not exists keypad_call (
  id serial primary key,

  -- Not nullable, unlike `call.user_id`. That column is nullable because the
  -- calls made before staff logins existed belong to nobody; this table starts
  -- after them, and the Keypad is reached through a per-person grant, so there
  -- is no such thing as an unattributed keypad call.
  user_id integer not null references app_user(id),

  -- As dialled: E.164, because the Keypad refuses to ring anything else. The
  -- country is read back off the number itself — there is no list here to
  -- carry a market, which is the collision `classifyPhone` documents.
  phone text not null,

  -- The saved line's name when the number was picked off the list rather than
  -- typed ("pxn junk removal"). Null for a typed number, and the log then reads
  -- by number, which is all there is to know about it.
  label text,

  -- The caller ID presented. Per person and set on Team, so it can change
  -- under someone; recorded here as what this call actually went out as.
  from_did text,

  -- Joins to `call_recording.call_session_id`, the same way `call` does. The
  -- recordings were already being saved — the outbound voice profile records
  -- everything and there is no per-call switch — they simply had nothing
  -- pointing at them.
  telnyx_session_id text,

  -- The browser's timer, answer to hangup. Zero for a call nobody picked up,
  -- which is most of them, and which is why this is not derived from the
  -- recording: a no-answer has no recording at all.
  duration_seconds integer,

  -- This was the second leg of a keypad conference — a demo line added to a
  -- call already up. Both legs are their own call to Telnyx, with their own
  -- recording, so both get a row; without this the pair reads as two unrelated
  -- dials a minute apart.
  added_to_call boolean not null default false,

  called_at timestamptz not null default now()
);

-- Both declared in src/db/schema.ts as well as here. `drizzle-kit push` drops
-- any index it cannot see in that file — which is how `call_user_id_idx` went
-- missing once already.
create index if not exists keypad_call_called_at_idx on keypad_call (called_at desc);
create index if not exists keypad_call_user_idx on keypad_call (user_id);

commit;
