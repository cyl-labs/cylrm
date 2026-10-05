-- Training meetings (2026-10-05). A practice meeting a founder hands a new closer,
-- with another person's CRM line as the prospect. `training` keeps it out of every
-- real number, alert and fee; `training_outcome` is where the practice answer
-- goes, so nothing touches call_demo_attendance (and so never payroll). Deleting
-- the row is the whole of undoing one. Additive; apply before deploying the code.
alter table call_meeting add column if not exists training boolean not null default false;
alter table call_meeting add column if not exists training_outcome text;
