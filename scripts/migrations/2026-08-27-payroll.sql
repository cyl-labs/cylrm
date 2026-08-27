-- What each caller is owed, and what has actually been handed over.
--
-- Apply BEFORE deploying the code that reads it.
--
--   docker exec -i cylrm-db psql -U cylrm -d cylrm < this-file.sql
--
-- Two things are paid: a bonus per 50 pickups, and a fee per meeting that the
-- prospect turned up to. The second had nowhere to live — `call_outcome` runs
-- no_answer … demo_booked … trial, won, lost, and none of those distinguishes
-- a meeting that happened from one that was merely agreed to. `trial` is not a
-- stand-in: the SOP pays on attendance and says so in as many words ("whether
-- they buy is not your problem"), so a prospect who turned up and declined
-- earns the fee and never reaches trial.
--
-- Hence `call_demo_attendance`, which is Payroll's own record and leaves the
-- outcome enum, the pipeline board and the stats alone.
--
-- Safe to re-run.

begin;

-- Money is integer cents everywhere below. Nothing else in this schema stores
-- an amount, so there is no house style to follow; a float in a payment record
-- would be the wrong choice regardless.
create table if not exists payout (
  id serial primary key,
  user_id integer not null references app_user(id),
  paid_at timestamptz not null default now(),

  -- The period this closes: the previous payout's `paid_at`, or the account's
  -- `created_at` for the first one, through `paid_at`. Contiguous and
  -- non-overlapping by construction, which is the point — there is no gap
  -- between two payouts for a day's work to fall into and go unpaid.
  period_start timestamptz not null,
  period_end   timestamptz not null,

  -- Monday (Eastern) of the week `paid_at` falls in. Stored rather than
  -- derived on read so that grouping the history by week cannot shift
  -- underneath old rows if the reporting zone moves again — it has moved once
  -- already, from Singapore to New York.
  week_start date not null,

  -- What was true at the moment of payment. Kept rather than recomputed: a
  -- call edited or a lead deleted afterwards must not be able to change what
  -- this row says was paid, or the history stops being evidence.
  pickups                  integer not null,
  pickup_bonus_cents       integer not null,
  meetings                 integer not null,
  meeting_commission_cents integer not null,
  total_cents              integer not null,

  -- The rates in force at the time. Raising a rate later would otherwise
  -- rewrite every past payout's apparent basis.
  pickups_per_bonus       integer not null,
  pickup_bonus_rate_cents integer not null,
  meeting_rate_cents      integer not null,

  note text,
  -- Which admin pressed the button. Nullable only so the row survives that
  -- account being removed; in practice it is always set.
  created_by_user_id integer references app_user(id)
);

create index if not exists payout_user_idx on payout (user_id, paid_at desc);
create index if not exists payout_week_idx on payout (week_start desc);

-- Did the meeting happen.
--
-- Prefixed `call_` because "demo" is overloaded: the email side counts demos
-- too, on the `deal` pipeline and in the A/B variant stats, and the two systems
-- share no data by design. An unprefixed name here would read as either.
create table if not exists call_demo_attendance (
  id serial primary key,

  -- The `demo_booked` call this answers. Per call rather than per lead: a
  -- no-show is rung back and booked again — the SOP allows two — and each
  -- booking is its own question with its own answer.
  call_id integer not null unique references call(id) on delete cascade,

  -- Denormalised off the call so the one-fee-per-business guard below can be
  -- an index rather than a promise the UI makes.
  call_lead_id integer not null references call_lead(id) on delete cascade,

  showed_up boolean not null,
  marked_at timestamptz not null default now(),
  marked_by_user_id integer references app_user(id),

  -- Set when a payout claims this attendance; null means still owed.
  --
  -- Owed is deliberately a state and not a date range. Comparing the meeting's
  -- date against the caller's last payout would silently drop any attendance
  -- confirmed late — mark a fortnight-old meeting as showed-up after that
  -- period has been paid and the caller would never be paid for it. Pinned by
  -- payout id instead, an unpaid attendance stays owed however old it is.
  payout_id integer references payout(id)
);

-- One business earns the fee once, however many times it was booked and
-- rebooked. An index rather than a check in the route, because this one is
-- about money and the route is not the only thing that could ever write here.
create unique index if not exists call_demo_attendance_one_show_per_lead_idx
  on call_demo_attendance (call_lead_id) where showed_up;

-- The owed query's index: attended, unpaid.
create index if not exists call_demo_attendance_unpaid_idx
  on call_demo_attendance (payout_id) where showed_up and payout_id is null;

commit;
