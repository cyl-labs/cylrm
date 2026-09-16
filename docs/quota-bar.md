# Weekly quota bar (Call CRM)

Part of the cylrm project notes — the always-loaded core is `AGENTS.md`,
and the product spec is `BLUEPRINT.md`.

A strip under the header on every screen, showing a caller's calls this week
against **300** (`WEEKLY_CALL_QUOTA` in `src/lib/call-quota.ts`, a
database-free module for the reason `payroll-rates.ts` is one). Rendered by
`components/calls/quota-bar.tsx`, mounted in `PageShell`, fed by
`getWeekProgress` in `call-stats.ts`.

- **It exists because the answer was otherwise unreachable.** Knowing where you
  stood meant opening the Scoreboard and picking a range, a feature nobody had
  been shown, so in practice callers had no idea until Friday. A number you
  have to go and look up is a number nobody looks up.
- **Counted by `getCallTotals`, never a query of its own**, so "a call" means
  what it means on Stats and the Scoreboard. A bar in the header disagreeing
  with the screen underneath it would be worse than no bar. `cache()`d, like
  `countUnreadReplies` and `countCallbacksDue`, since the shell asks on every
  page render.
- **The week is Payroll's week**: Monday, cut in `STATS_TZ`, not in whatever
  the reader picked with the timezone picker. A quota week that moved with a
  dropdown would let somebody change how much work they owe by changing a
  setting, and it would drift from the week they are paid on.
- **`payWeekStart` moved to `call-stats.ts`** on 2026-09-01 and is re-exported
  from `payroll.ts`. That module already imports `PICKUP` from call-stats, so
  importing the week helper back would have closed a cycle; the definition
  follows the existing dependency direction and every caller kept working.
- **Nothing is capped except the bar's width.** Someone who rings 340 is shown
  340 and told the extra landed. A counter frozen at 300 would quietly tell the
  best caller on the floor that their last forty did not count, and the target
  is the floor rather than the ceiling.
- **Callers only**, the same reason they are the only ones on the Scoreboard
  and the payroll confirm list. A caller can only ever be on a Call CRM screen,
  so the role is the whole check and no workspace test is needed.
- Under the header rather than inside it: the header already carries the page
  title and that page's own controls, and Stats has four. The "N to go" half is
  what gives below `sm`; the count is what is worth keeping.
