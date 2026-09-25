-- A contract is sent when a text with its link went to that business
-- (2026-09-25), not to anybody.
--
-- The first backfill counted any text carrying the link, so a founder texting
-- a link to their own phone to check it marked it sent: Safe Movers Maui's
-- trial agreement read "sent" off a text to the demo line (+1 929 543 0520),
-- and Santa Fe's paid agreement off one to +1 720 371 6663, which is no lead.
-- This recomputes sent_at for every unsigned contract from texts that went to
-- the business itself (its thread, its listed number, or a number it booked
-- with), keeping a copy-link time when it is earlier. Signed contracts keep
-- theirs: signing proves it reached them.
with valid as (
  select c.id, min(sm.created_at) as first_sent
  from call_contract c
  join call_sms sm
    on sm.direction = 'out'
   and strpos(sm.body, '/s/' || c.signer_slug) > 0
  where sm.call_lead_id = c.call_lead_id
     or exists (select 1 from call_lead l
                where l.id = c.call_lead_id and '+' || l.phone_key = sm.to_number)
     or exists (select 1 from call_meeting m
                where m.call_lead_id = c.call_lead_id and m.attendee_phone = sm.to_number)
  group by c.id
),
wrong as (
  -- A sent_at that is exactly a text to someone else: set by the first
  -- backfill, not by a copy of the link.
  select distinct c.id
  from call_contract c
  join call_sms sm
    on sm.direction = 'out'
   and strpos(sm.body, '/s/' || c.signer_slug) > 0
   and sm.created_at = c.sent_at
)
update call_contract c
set sent_at = (select v.first_sent from valid v where v.id = c.id)
where c.signed_at is null
  and c.id in (select id from wrong)
  and c.id not in (select id from valid where first_sent = c.sent_at);
