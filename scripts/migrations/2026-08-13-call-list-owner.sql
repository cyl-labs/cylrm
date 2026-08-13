-- Give each calling niche an owner.
--
-- A label rather than a lock: nothing in the app refuses a call because the
-- list belongs to someone else. Somebody off sick should not take their niche
-- out of the day with them, and a caller who runs dry should not have to wait
-- for a reassignment to keep working.
--
-- Null means unassigned, which is what every existing list starts as.
--
-- Safe to re-run. Depends on 2026-08-13-app-user.sql.

begin;

alter table call_list
  add column if not exists assigned_user_id integer references app_user(id);

commit;
