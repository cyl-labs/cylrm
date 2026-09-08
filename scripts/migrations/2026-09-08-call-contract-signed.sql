-- When a drafted contract was signed by the client.
--
-- The CRM drafted contracts and then never heard another word about them: the
-- chip on a meeting row read "Trial agreement" whether nobody had signed it or
-- both parties had, and the only way to find out was to open DocuSeal. That is
-- the wrong way round for the one event in this whole feature worth knowing
-- about — and DocuSeal cannot tell anybody itself, since its mailer cannot send
-- from this droplet at all.
--
-- Filled in by `POST /api/contracts/signed`, called by the n8n workflow that
-- already receives DocuSeal's `submission.completed` webhook and drafts the
-- signed copy into Gmail. Null means "not signed as far as we know", which is
-- also what every existing row means, so no backfill is possible or wanted.
--
-- Deliberately only the client's signature. Cyl Labs signing its own side first
-- is routine — it is how a PDF is got in hand before a demo — and recording
-- that as "signed" would make the chip claim a deal that has not happened. Same
-- rule the discard guard follows.

begin;

alter table call_contract add column if not exists signed_at timestamptz;

commit;
