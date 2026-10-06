-- A closer closes the meetings they booked, with no founder handing them over.
-- Data only, no schema change: sets call_meeting.closer_user_id on meetings
-- already booked by a closer and not yet handed to anybody. Founders can hand
-- any of them back from the row. Safe to run twice.
update call_meeting m
set closer_user_id = c.user_id
from "call" c
join app_user u on u.id = c.user_id
where c.id = m.call_id
  and u.role = 'closer' and u.active
  and m.closer_user_id is null
  and m.training = false;
