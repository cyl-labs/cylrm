-- A written summary of a long call (2026-10-02), kept on the recording beside
-- its transcript. Additive; apply before deploying (the recording sheet's
-- fetch selects it).
alter table call_recording add column if not exists summary text;
alter table call_recording add column if not exists summary_at timestamptz;
