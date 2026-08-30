-- Browser push, so a meeting reminder reaches somebody who has not opened the
-- CRM yet today.
--
-- Push rather than email: nobody has to install anything on a desktop, there
-- is no address to collect (app_user has none), and no spam folder to land in
-- -- which matters here, because the only mailboxes this app can send from are
-- the cold-outreach ones whose domains are burned. A reminder that silently
-- does not arrive is worse than no reminder, since people stop trusting it.

begin;

create table if not exists push_subscription (
  id serial primary key,
  user_id integer not null references app_user(id) on delete cascade,

  -- The push service's URL for this browser. Unique because it *is* the
  -- identity of a subscription: the same person on a laptop and a phone has
  -- two, and re-subscribing in the same browser returns the same endpoint,
  -- which is why the insert upserts rather than piling up duplicates.
  endpoint text not null unique,

  -- The browser's public key and auth secret, used to encrypt each payload so
  -- the push service in the middle cannot read it.
  p256dh text not null,
  auth text not null,

  -- Which device this is, roughly, so somebody can tell two rows apart when
  -- turning one off.
  user_agent text,

  created_at timestamptz not null default now(),
  -- Last time a send to this endpoint succeeded. A subscription that has gone
  -- stale is deleted on the 404/410 the push service returns, so this is for
  -- looking at rather than for logic.
  last_ok_at timestamptz
);

create index if not exists push_subscription_user_idx
  on push_subscription (user_id);

-- One nudge per person per day.
--
-- The tick that sends these runs every five minutes, so without a record of
-- what has gone out a caller would be pushed 288 times a day. Same lesson as
-- send_issue.signature, and the unique index is the mechanism rather than a
-- check in the code: two overlapping ticks cannot both win an insert.
--
-- The date is *their* local date, not UTC. A reminder is about their working
-- day, and a caller in Singapore and one in New York are on different ones.
create table if not exists meeting_push_log (
  id serial primary key,
  user_id integer not null references app_user(id) on delete cascade,
  sent_on date not null,
  meetings integer not null,
  created_at timestamptz not null default now()
);

create unique index if not exists meeting_push_log_once_per_day_idx
  on meeting_push_log (user_id, sent_on);

commit;
