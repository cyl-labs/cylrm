import { sql } from "drizzle-orm";
import { db } from "@/db";
import { phoneKeyCandidates } from "@/lib/calls";
import { callScope, getCurrentUser } from "@/lib/session";

/**
 * Who is ringing, and what was said last time.
 *
 * An inbound call arrives as a number and nothing else, which is the worst
 * possible thing to answer: somebody ringing back has already had a
 * conversation, and starting it again from "who am I speaking to" wastes the
 * one advantage a callback has.
 *
 * Matched on `phone_key` — digits only — because that is what the importer
 * stores and what dedupe already relies on, so a number written any of the ways
 * a directory writes it still finds its lead. Against every key the line could
 * be under, not just one: the SDK reports a caller without their country code,
 * and keying on that alone made a lead in the caller's own niche ring in as an
 * unknown number.
 *
 * Scoped like every other calling query: a caller sees a lead on their own
 * niches, an admin sees any. An unmatched number is a perfectly ordinary
 * answer, not an error — somebody can ring a number that was never in a list.
 */
export async function GET(request: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const from = new URL(request.url).searchParams.get("from") ?? "";
  // Every way this line could be stored, because the number arrives from the
  // SDK without its country code — see `phoneKeyCandidates`.
  const keys = phoneKeyCandidates(from);
  if (keys.length === 0) return Response.json({ lead: null });

  const owner = callScope(me);
  const [lead] = (await db.execute(sql`
    select l.id, l.company, l.name, l.phone, l.title, l.website,
           cl.name as list_name
    from call_lead l
    join call_list cl on cl.id = l.call_list_id
    where l.phone_key = any(${keys})
      ${owner === undefined ? sql`` : sql`and cl.assigned_user_id = ${owner}`}
    -- A number can sit on more than one list when a duplicate was kept rather
    -- than dropped. The original is the one with the history on it.
    order by l.duplicate_of_lead_id nulls first, l.id
    limit 1
  `)) as {
    id: number;
    company: string | null;
    name: string | null;
    phone: string;
    title: string | null;
    website: string | null;
    list_name: string;
  }[];

  if (!lead) return Response.json({ lead: null });

  // The last few calls, newest first. Notes are the point — the outcome alone
  // says a callback was promised, the note says what for.
  const history = (await db.execute(sql`
    select c.called_at, c.outcome::text as outcome, c.notes, u.name as caller
    from call c
    left join app_user u on u.id = c.user_id
    where c.call_lead_id = ${lead.id}
    order by c.called_at desc
    limit 5
  `)) as {
    called_at: string;
    outcome: string;
    notes: string | null;
    caller: string | null;
  }[];

  return Response.json({
    lead: {
      id: lead.id,
      company: lead.company,
      name: lead.name,
      phone: lead.phone,
      title: lead.title,
      website: lead.website,
      list: lead.list_name,
      history: history.map((h) => ({
        at: new Date(h.called_at).toISOString(),
        outcome: h.outcome,
        notes: h.notes,
        caller: h.caller,
      })),
    },
  });
}
