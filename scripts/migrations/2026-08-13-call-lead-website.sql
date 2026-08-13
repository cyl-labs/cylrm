-- Give call_lead its own website column, and fill it from what the scrapes
-- already brought in.
--
-- The data was never missing: source_fields keeps every raw CSV column, and
-- `website` is present on 599 of 679 leads (plus `website_url` and `domain`
-- on a couple of the older lists). Promoting it to a column is what makes it
-- editable and queryable rather than buried in jsonb.
--
-- Safe to re-run.

begin;

alter table call_lead add column if not exists website text;

-- Priority mirrors the importer's aliases: an explicit website column beats a
-- bare domain. `source_url` and `provenance_url` are deliberately not in here
-- — they say where the scraper found the lead, which is often a directory
-- listing rather than the company's own site.
update call_lead l
set website = coalesce(
  nullif(btrim(l.source_fields->>'website'), ''),
  nullif(btrim(l.source_fields->>'website_url'), ''),
  nullif(btrim(l.source_fields->>'domain'), '')
)
where l.website is null
  and l.source_fields is not null;

-- Same two rules websiteHref applies, so the column does not carry values the
-- app will refuse to render: the placeholders a scrape writes when it found
-- nothing, and anything with no dot in it, which is a note and not a domain.
update call_lead
set website = null
where website is not null
  and (
    lower(btrim(website)) in (
      'n/a', 'na', 'none', 'null', 'undefined', '-',
      'no website', 'not found', 'none found'
    )
    or website not like '%.%'
  );

commit;
