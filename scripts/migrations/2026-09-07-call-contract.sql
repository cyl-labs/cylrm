-- Contracts drafted from the CRM into DocuSeal, one row per document.
--
-- Both agreements have to exist, filled in, before a demo starts: the trial in
-- case they say yes on the call, the paid one in case they skip the trial. Both
-- were being typed out by hand each time — the business name, the signee, the
-- date, and on the paid one the whole fee table — which is four chances to get
-- a client's legal name wrong on something they are about to sign.
--
-- This table is the CRM's memory of what it drafted. DocuSeal owns the document
-- itself; nothing here duplicates its contents, because a second copy of a
-- contract is a second copy that can be wrong. What is kept is only enough to
-- put a link on the meeting row and to refuse to draft the same thing twice.

begin;

create table if not exists call_contract (
  id serial primary key,

  -- The meeting this was drafted for. Cascades, because a contract drafted for
  -- a booking that no longer exists is not something anybody will go looking
  -- for, and the document itself survives in DocuSeal regardless.
  meeting_id integer not null references call_meeting(id) on delete cascade,

  -- Denormalised on purpose, and nullable for the same reason `call_meeting`
  -- is: an unlinked booking has no lead, and must still be able to have a
  -- contract drafted for it — that is the booking most likely to be a real
  -- enquiry off the public link.
  call_lead_id integer references call_lead(id) on delete set null,

  -- Who pressed the button. Not the signer: the signer is on the document.
  user_id integer references app_user(id),

  -- `trial` | `paid`. Two rows per meeting at most, which the unique index
  -- below enforces.
  kind text not null,

  -- DocuSeal's own identifiers. The submission is the document; the slug is
  -- the path on the signing URL, which is what the screen links to. Neither is
  -- a URL — the host lives in DOCUSEAL_URL, so moving instances (the cloud to
  -- our own server, say) does not orphan every link ever written.
  submission_id integer not null,
  sender_slug text not null,
  signer_slug text not null,

  -- Which template it came from, so a contract drafted before a template was
  -- replaced can still be told apart from one drafted after.
  template_id integer not null,

  -- What was actually put on the paper. A snapshot, exactly as `payout` snapshots
  -- its rates: raising a price must not rewrite what a contract said when it was
  -- drafted, and this is the only record of that on our side. Null on a trial,
  -- which has no package — its fee is printed into the template.
  package_id text,
  term_id text,
  -- The rendered strings, not the cents, because what matters afterwards is what
  -- the client read.
  field_values jsonb,

  created_at timestamptz not null default now()
);

-- One trial and one paid agreement per meeting. A second press of the button
-- must not quietly mint a second contract with a different price on it: the
-- route reads this first and hands back what already exists.
create unique index if not exists call_contract_meeting_kind_idx
  on call_contract (meeting_id, kind);

create index if not exists call_contract_lead_idx on call_contract (call_lead_id);

commit;
