-- "Sent" is texts only (2026-09-25). Copying the client's link from the row
-- counted for a few hours and marked Toro Dumpsters sent when the chip was
-- clicked to look at it. Unsigned contracts are reset to the first text that
-- went to the business, or null.
update call_contract c
set sent_at = (
  select min(sm.created_at)
  from call_sms sm
  where sm.direction = 'out'
    and strpos(sm.body, '/s/' || c.signer_slug) > 0
    and (
      sm.call_lead_id = c.call_lead_id
      or exists (select 1 from call_lead l
                 where l.id = c.call_lead_id and '+' || l.phone_key = sm.to_number)
      or exists (select 1 from call_meeting m
                 where m.call_lead_id = c.call_lead_id and m.attendee_phone = sm.to_number)
    )
)
where c.signed_at is null;
