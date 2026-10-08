-- An optional note on a quiet move (2026-10-09), shown on the row beside
-- "Moved quietly from ...". Additive; apply before deploying the code, since
-- the Meetings screen selects it by name.
alter table call_meeting add column if not exists move_note text;
