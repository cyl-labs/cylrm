-- Hold the US Do Not Call register locally instead of paying per lookup.
--
-- The FTC *distributes* the register — you download it per area code, and the
-- first five area codes cost nothing each year — so screening is a set
-- membership test against a table we own: free, instant, no rate limit, no
-- third party. (Singapore's PDPC never releases its register and answers only
-- metered per-number queries, which is why the same trick is impossible there;
-- see lib/dnc.ts for why Singapore is not screened at all.)
--
-- Two tables, because a number and a date answer different questions:
-- `dnc_number` is the register, `dnc_area_code` is when each slice of it was
-- last downloaded. Without the second, a lead could be marked clean against a
-- snapshot taken a year ago and look perfectly screened — the same trap as
-- storing a status without a check date, one level up.
--
-- Safe to re-run.

begin;

-- Ten-digit NANP numbers, digits only. Primary key rather than a plain index:
-- the loader re-inserts an area code wholesale and the conflict is the dedupe.
create table if not exists dnc_number (
  number text primary key,
  area_code text not null
);

create index if not exists dnc_number_area_code_idx on dnc_number (area_code);

-- One row per downloaded area code. A lead whose area code is missing here has
-- never been screenable, which blocks it just as firmly as being listed.
create table if not exists dnc_area_code (
  area_code text primary key,
  loaded_at timestamptz not null default now(),
  number_count integer not null default 0
);

commit;
