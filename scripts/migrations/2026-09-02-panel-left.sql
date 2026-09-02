-- Which document sits in the dialler's left column, per caller.
--
-- Apply BEFORE deploying the code that reads it, though a missing column here
-- only costs the preference: the code falls back to 'objections', which is what
-- everybody has today.
--
-- Callers disagree about this and both are defensible. Somebody still learning
-- the pitch wants the script open and the objections a key away; somebody who
-- knows the pitch wants the objections open, because that is the part they
-- reach for under pressure. It is a working preference, not a policy, so it is
-- theirs to set rather than an admin's to assign — the same reasoning as
-- `stats_region`, which is why this follows that column's shape rather than
-- living in a browser.
--
-- Whichever is not in the column is what the "o" key opens, so the pair always
-- covers both and neither is ever unreachable.
alter table app_user
  add column if not exists panel_left text not null default 'objections';
