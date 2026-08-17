-- A phone number per caller, not just per market.
--
-- Two reasons, and the second is the expensive one. A prospect ringing back
-- reaches the person who actually spoke to them rather than a shared line
-- nobody owns. And carriers flag numbers on volume, short calls and low answer
-- rates, which is the exact profile of cold calling: three people dialling all
-- day from one number tripled the signal on it, and once it is marked "Scam
-- Likely" the answer rate collapses for everyone on that market at once.
-- Separate numbers isolate that.
--
-- Null falls back to the market's number in `call_did`, so a new hire dials on
-- day one instead of waiting for a number to be bought.
--
-- Safe to re-run.

begin;

alter table app_user add column if not exists telnyx_did text;

commit;
