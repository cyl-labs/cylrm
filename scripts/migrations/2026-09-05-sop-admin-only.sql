-- Founder-only SOP documents.
--
-- The library has only ever scoped by market: `region` decides which script a
-- caller sees, and null means everyone. That has no way to express "reference
-- material the founders read and the floor does not", which is what the
-- closing procedure is — it describes the demo call and the commercial terms,
-- neither of which is a cold caller's job.
--
-- Default false, so every existing document keeps exactly the audience it has
-- today and this migration changes nothing on its own.
--
-- Apply BEFORE deploying the code: `listSopDocuments` and `getDiallerSop`
-- both select this column, so the Scripts screen and the dialler's script
-- panel error without it — and `seed-sop.mjs` writes it, so the deploy
-- itself fails at the publish step.

alter table sop_document
  add column if not exists admin_only boolean not null default false;
