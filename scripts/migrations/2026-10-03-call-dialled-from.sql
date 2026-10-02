-- Which of our numbers a call was placed from (2026-10-03), so a number's
-- health follows the number and not whoever holds it now. Additive: apply
-- before deploying the code, which writes and reads it.
alter table "call" add column if not exists dialled_from text;

-- Exact where a recording exists: its from_number is the caller ID that was
-- used. Calls with no recording stay null and are read as the caller's
-- current number, which is right until that number is swapped.
update "call" c
set dialled_from = cr.from_number
from call_recording cr
where cr.call_session_id = c.telnyx_session_id
  and c.dialled_from is null
  and cr.from_number is not null;

create index if not exists call_dialled_from_idx on "call" (dialled_from, called_at desc);
