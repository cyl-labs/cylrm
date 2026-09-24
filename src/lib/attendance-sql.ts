import { sql } from "drizzle-orm";

/**
 * Whether attendance row `a` answers meeting `m`, as a SQL condition over the
 * two aliases.
 *
 * Attendance is recorded per booking call and read per meeting, so every
 * query that asks "what happened at this meeting" has to decide which answers
 * are about it. It was `a.marked_at >= m.start_at` in seven places: only an
 * answer given after the meeting began can be about it, which is what keeps a
 * lead's old no-show off the demo they rebooked.
 *
 * That rule has no room for an answer given early, and founders need one
 * (2026-09-25): a booking that is not real — a test, a duplicate, somebody who
 * rang to say they never meant it — should be written off while it is still in
 * the diary, not after it has sat there reminding everybody. So an answer given
 * from the Meetings row names the meeting and the slot it was about
 * (`meeting_id`, `for_start_at`), and counts for that meeting at that time.
 * Moving the meeting changes `start_at`, so the question reopens rather than
 * the old answer riding along to the new time — the same pin
 * `call_meeting_followup.for_start_at` uses.
 *
 * An answer pinned to one meeting is never read as another's. Answers from
 * Payroll carry no pin and keep the old rule.
 *
 * Aliases rather than columns because the queries that need this use `a`/`m`
 * and `a`/`mm`, and Drizzle renders interpolated columns unqualified inside a
 * subquery (see AGENTS.md, Gotchas).
 */
const answers = (a: string, m: string) => `(
    (${a}.meeting_id is null or ${a}.meeting_id = ${m}.id)
    and (${a}.marked_at >= ${m}.start_at or ${a}.for_start_at = ${m}.start_at)
  )`;

export const answersMeeting = (a: string, m: string) => sql.raw(answers(a, m));

/**
 * `m` has not been answered ahead of time. For the reminders and digests,
 * which only look at meetings still to come — so the only answer that can
 * apply is an early one, and a booking a founder wrote off as not real should
 * stop announcing itself (2026-09-25).
 */
export const notAnsweredYet = (m: string) =>
  sql.raw(`not exists (
    select 1 from call_demo_attendance a
    where a.call_lead_id = ${m}.call_lead_id and ${answers("a", m)}
  )`);
