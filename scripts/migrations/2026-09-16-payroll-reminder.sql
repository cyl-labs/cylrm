-- The Friday payday reminder, and the settings that decide when it fires.
--
-- APPLY BEFORE DEPLOYING. `sendPayrollReminder` selects the new `app_setting`
-- columns and inserts into `payroll_reminder_sent`, and with push configured
-- in prod it does not take the "nothing to do" branch — so a missing column or
-- table is a cron job throwing every five minutes.
--
-- WHY IT IS SETTABLE. Asked for as "every Friday 5pm" with the schedule in the
-- founders' hands rather than in a constant, which is right: payday is a
-- business decision, and the one thing guaranteed about it is that it moves.
-- `app_setting` is this app's single-row settings table, so the schedule lives
-- there as columns beside the sending window rather than in a key/value store.
--
-- WHICH CLOCK, AND WHY IT IS NOT THE ONE PAYROLL USES. Every other payroll
-- number is cut in STATS_TZ on purpose: what somebody is owed must not depend
-- on which clock the person paying them reads. A *reminder* is the opposite
-- kind of thing — it is a nudge to a human, and "Friday 5pm" means 5pm where
-- that human is. The founders are in Singapore, so firing on Eastern would
-- deliver it at 5am Saturday their time. It therefore sends on the recipient's
-- own zone, the way the callback digest does, and `week_start` below is only
-- an idempotency key rather than a reporting window.
alter table app_setting
  add column if not exists payroll_reminder_on boolean not null default true;
-- ISO weekday: 1 = Monday … 7 = Sunday. 5 = Friday.
alter table app_setting
  add column if not exists payroll_reminder_weekday integer not null default 5;
-- Hour of that day, 0-23, in the recipient's own zone. 17 = 5pm.
alter table app_setting
  add column if not exists payroll_reminder_hour integer not null default 17;

-- One reminder per founder per pay week. Keyed on the week rather than the day
-- for the reason the quota digest is: it lets the send window run on past the
-- configured hour — so a worker outage on Friday evening still delivers on
-- Saturday — while making a second send for that week impossible.
create table if not exists payroll_reminder_sent (
  id serial primary key,
  user_id integer not null references app_user(id) on delete cascade,
  -- The Monday the pay week began, in STATS_TZ. An idempotency key, not a
  -- reporting window: the *send time* is judged in the recipient's own zone.
  week_start date not null,
  -- What the reminder claimed was owed, kept so the number can be checked back.
  owed_cents integer not null,
  created_at timestamptz not null default now()
);

create unique index if not exists payroll_reminder_sent_once_per_week_idx
  on payroll_reminder_sent (user_id, week_start);
