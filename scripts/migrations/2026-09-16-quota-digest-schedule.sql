-- Make the quota digest's schedule settable, like the payday reminder's.
--
-- APPLY BEFORE DEPLOYING, for the reason the payday one needs it: with push
-- configured the "nothing to do" branch is not taken, so a missing column is a
-- cron job throwing every five minutes.
--
-- WHY THIS EXISTS AT ALL, since it is an inconsistency being repaired rather
-- than a feature being added. The quota digest was asked for as "end of the
-- week on Friday" and hard-coded; the payday reminder was asked for as "make
-- it settable" and built settable. Two instructions taken literally produced
-- two reminders that behave differently for no reason a reader could defend.
--
-- It also fixes a real defect. The hard-coded version fired at Friday 17:00
-- *Eastern* — chosen because the quota week is cut in `STATS_TZ` — which is
-- 05:00 on Saturday in Singapore, where the founders are. That conflated the
-- window being measured with the moment somebody is told about it. The week
-- stays Eastern; the *send* now follows the recipient's own clock, exactly as
-- the payday reminder does.
--
-- The default stays Friday 17:00 because that is what was asked for, now read
-- locally. Worth knowing when reading the digest: at Friday 5pm Singapore it
-- is Friday 5am Eastern, so the US floor has not worked that day yet and the
-- numbers will be lower than they finish. Saturday morning is one dropdown
-- away for anybody who would rather have the complete week.
alter table app_setting
  add column if not exists quota_digest_on boolean not null default true;
-- ISO weekday: 1 = Monday … 7 = Sunday. 5 = Friday.
alter table app_setting
  add column if not exists quota_digest_weekday integer not null default 5;
-- Hour of that day, 0-23, in the recipient's own zone. 17 = 5pm.
alter table app_setting
  add column if not exists quota_digest_hour integer not null default 17;
