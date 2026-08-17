-- The scripts and procedures callers work from.
--
-- Read-only in the app: content is edited as markdown files under `content/sop/`
-- and published by `scripts/seed-sop.mjs` on deploy. There is no editor, no
-- upload and no revision history, because the files are already in git — which
-- is a better history than anything worth building here.
--
-- `region` is the only axis. Null means shared, which is how procedures are
-- stored; scripts and objection handling carry 'sg' or 'us'. The two regional
-- variants are separate documents that happen to differ, not one document with
-- conditional sections.
--
-- Safe to re-run.

begin;

create table if not exists sop_document (
  id serial primary key,
  -- Matches the file name, and the key the seeder upserts on. Stable across
  -- edits so a bookmarked URL survives a rewrite of the content.
  slug text not null unique,
  kind text not null,
  -- 'sg' | 'us', or null for shared.
  region text,
  title text not null,
  body_md text not null,
  updated_at timestamptz not null default now()
);

-- One script and one objection sheet per region. Procedures are exempt: there
-- can be many, and they all sit at region null, which a plain unique index
-- would not catch anyway since Postgres treats nulls as distinct.
create unique index if not exists sop_document_kind_region_idx
  on sop_document (kind, region)
  where kind in ('script', 'objections');

commit;
