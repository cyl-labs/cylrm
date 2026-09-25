-- When a contract's signing link first went to the client.
--
-- Asked for with the meeting stats (2026-09-25): "how many contracts were
-- sent, how many got signed". Drafting emails nothing (send_email false), and
-- copying the client's link from the row is the whole route a contract leaves
-- the CRM by, so the first copy is when it was sent. DocuSeal's own opened_at
-- was considered and rejected: a founder previewing the client's page from
-- the row opens it too (Superior Rental read "opened" 41 seconds after it was
-- drafted).
--
-- Backfilled only where it is certain: a signed contract was sent. Older
-- unsigned ones stay null, "not recorded", rather than guessed.
--
-- Apply before deploying: meetingSelect reads it.
alter table call_contract
  add column if not exists sent_at timestamptz;

update call_contract set sent_at = signed_at
  where sent_at is null and signed_at is not null;
