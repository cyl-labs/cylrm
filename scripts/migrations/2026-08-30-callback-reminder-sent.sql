-- One "x callbacks due today" a day, per person.
--
-- Unlike a meeting, a callback exists nowhere but in this database: nothing
-- else sends the prospect an invite or reminds anybody it was promised. If the
-- caller does not look at the diary, the promise is simply broken.
--
-- A digest rather than one notification each, which is the opposite of the
-- choice made for meetings and deliberately so: demos are rare and individually
-- valuable, callbacks run at a dozen a day, and a caller who gets a dozen
-- notifications turns notifications off — which would cost them the meeting
-- reminders too.

begin;

create table if not exists callback_reminder_sent (
  id serial primary key,
  user_id integer not null references app_user(id) on delete cascade,

  -- Their local date, not UTC: this is about somebody's working day, and a
  -- caller in Singapore is not on the same one as a caller in New York.
  sent_on date not null,

  -- What the digest claimed, kept so a "you said 6" can be checked later.
  callbacks integer not null,

  created_at timestamptz not null default now()
);

-- The claim is an insert rather than a check: the tick runs every five minutes
-- and two overlapping ones can both pass a check, but only one can win an
-- index.
create unique index if not exists callback_reminder_sent_once_per_day_idx
  on callback_reminder_sent (user_id, sent_on);

commit;
