-- Do Not Call screening.
--
-- Singapore's PDPA requires a number to be checked against the DNC Registry
-- before an unsolicited telemarketing call, and **the result expires after 21
-- calendar days** (cut from 30 on 2021-02-01). The US TSR has the same shape
-- with a 31-day window. That expiry is the whole reason this is two columns
-- rather than one: a boolean "is on the register" answers the wrong question,
-- because a list scrubbed clean at import is legally unscrubbed three weeks
-- later while still sitting in the dialler looking fine.
--
-- So every screen asks the same thing — is there a *recent* clean result —
-- and a lead with no check, or a lapsed one, is as undialable as a listed one.
--
-- Nothing is enforced until the environment is configured; see lib/dnc.ts.
-- Without that, an app with no scrubbing credentials would show every lead as
-- blocked and the floor would have nothing to call.
--
-- Safe to re-run.

begin;

-- 'clean' | 'listed'. Null means never checked, which blocks just the same
-- once enforcement is on — "we do not know" and "they said no" are the same
-- answer to "may I ring this".
alter table call_lead add column if not exists dnc_status text;
alter table call_lead add column if not exists dnc_checked_at timestamptz;

-- Which registry answered, so a lead carried between countries is not judged
-- on the wrong one: 'sg_pdpc' | 'us_rpv'.
alter table call_lead add column if not exists dnc_source text;

-- The registry's own answer, kept verbatim. If a check is ever challenged,
-- "clean" is an assertion; this is the evidence. The US service returns four
-- separate flags (national, state, DMA, litigator) that collapse into one
-- status here, and the detail is the only place they survive.
alter table call_lead add column if not exists dnc_detail jsonb;

-- The re-scrub job's working query: oldest checks first, nulls first.
create index if not exists call_lead_dnc_checked_at_idx
  on call_lead (dnc_checked_at nulls first);

commit;
