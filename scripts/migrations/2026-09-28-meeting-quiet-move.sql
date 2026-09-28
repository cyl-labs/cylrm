-- A founder can move a meeting on our calendar without Cal.com (2026-09-28).
-- `start_at` becomes the time we hold it at; `cal_start_at` is the time
-- Cal.com has, which the sync compares against so it only overwrites our time
-- when Cal.com's own time changes. Additive; apply before deploying the code,
-- which reads the column.
alter table call_meeting add column if not exists cal_start_at timestamptz;
update call_meeting set cal_start_at = start_at where cal_start_at is null;
