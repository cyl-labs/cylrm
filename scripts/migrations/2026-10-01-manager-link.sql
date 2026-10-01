-- A caller who manages other callers (2026-10-01). Not a role: a nullable link
-- from each person to whoever looks after them, so every admin test in the app
-- keeps meaning what it meant.
--   manager_id            who this person reports to (a founder sets it on Team)
--   weekly_quota          calls owed per week for this person; null = the default (300)
--   weekly_quota_by       who last set it, so a change can be traced
--   weekly_quota_at       when
--   paid_via_user_id      payouts for this person go to this other person's account
-- Additive and nullable. Apply before deploying the code: it selects them.
alter table app_user add column if not exists manager_id integer references app_user(id);
alter table app_user add column if not exists weekly_quota integer;
alter table app_user add column if not exists weekly_quota_by integer references app_user(id);
alter table app_user add column if not exists weekly_quota_at timestamptz;
alter table app_user add column if not exists paid_via_user_id integer references app_user(id);
create index if not exists app_user_manager_id_idx on app_user (manager_id);
