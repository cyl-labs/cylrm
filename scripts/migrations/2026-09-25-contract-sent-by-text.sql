-- Contracts sent by text count as sent (2026-09-25).
--
-- sent_at was only set by copying the client's link, but most contracts go
-- out in a text from the meeting row with the link in it ("Hey josey, it's
-- Mark sending over the docs right now" and the link after it, Superior
-- Rental), so they read "not sent". The code now marks a contract sent when
-- such a text goes out; this fills in the ones already texted, at the time of
-- the first text carrying their link. Only fills nulls or moves a time
-- earlier.
update call_contract c
set sent_at = s.first_sent
from (
  select c2.id, min(sm.created_at) as first_sent
  from call_contract c2
  join call_sms sm
    on sm.direction = 'out'
   and strpos(sm.body, '/s/' || c2.signer_slug) > 0
  group by c2.id
) s
where c.id = s.id
  and (c.sent_at is null or c.sent_at > s.first_sent);
