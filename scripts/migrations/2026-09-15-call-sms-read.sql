-- Which texts have been read, for the unread dots and badge on Texts.
--
-- Only inbound texts are ever marked, and only by the person they are for
-- (`call_sms.user_id`): an admin reading a caller's conversation must not make
-- it look already seen to the caller whose number it came in on.
--
-- ORDERING: apply BEFORE deploying the code. The sidebar badge reads
-- `read_at` from the app layout, so without the column every screen in the app
-- returns 500, the same way a missing `call_meeting` did.

alter table call_sms add column if not exists read_at timestamptz;

-- Texts already stored count as read. They arrived before there was anywhere
-- to read them, and a badge lit up for all of them on the first morning would
-- say nothing about what is new.
update call_sms set read_at = created_at
  where direction = 'in' and read_at is null;

-- The badge's query, which runs on every page for every signed-in person.
create index if not exists call_sms_unread_idx
  on call_sms (user_id)
  where direction = 'in' and read_at is null;
