import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/session";
import {
  briefConfigured,
  briefScope,
  briefSources,
  ensureTranscripts,
  fingerprint,
  getStoredBriefs,
  writeBrief,
} from "@/lib/meeting-brief";

/**
 * Write the briefing for every upcoming demo.
 *
 * Founders only, and that is a cost control as much as a permissions one: each
 * brief is an OpenAI call, and the people who take demos are the people who
 * need one. `/api` is outside the middleware matcher, so this check is the
 * only guard.
 *
 * Nothing is regenerated that has not changed. Every brief stores a hash of
 * the material it was written from, so pressing the button again the same
 * afternoon re-reads fourteen rows and spends nothing; logging another call on
 * a lead, or transcribing its recording for the first time, moves that hash
 * and only that one is rewritten. `force` overrides it, for when the prompt
 * itself has changed rather than the material.
 *
 * `meetingIds` narrows it to the meetings named, which is how the Briefing
 * fold on a Meetings row writes or refreshes its own brief when it is opened
 * (2026-09-24). Those come back in `briefs`, so the fold can show the result
 * without reloading the list. Named meetings are not held to `briefScope`: a
 * founder opening the fold on a demo from yesterday wants its context too, and
 * the cost is still one brief, written because somebody asked to read it.
 */

/** How many to write at once. Fourteen sequential calls is half a minute of
 *  somebody watching a spinner; fourteen at once is a burst OpenAI may rate
 *  limit and a failure mode that looks like the feature being broken. */
const CONCURRENCY = 4;

export async function POST(request: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  // A closer too, for the meetings handed to them and nothing else — checked
  // once the ids are read (2026-09-25). The brief is the handover from whoever
  // booked it to whoever takes the demo, and that is now sometimes them.
  if (me.role !== "admin" && me.role !== "closer") {
    return Response.json(
      { error: "Only a founder can generate the briefing." },
      { status: 403 },
    );
  }
  if (!briefConfigured()) {
    return Response.json(
      { error: "No OpenAI key is configured on this server." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    force?: unknown;
    meetingIds?: unknown;
  } | null;
  const force = body?.force === true;
  const asked = Array.isArray(body?.meetingIds)
    ? body.meetingIds
        .filter((v): v is number => Number.isInteger(v) && (v as number) > 0)
        .slice(0, 50)
    : null;
  if (asked !== null && asked.length === 0) {
    return Response.json({ error: "No meeting given." }, { status: 400 });
  }
  if (me.role === "closer") {
    const mine = asked
      ? ((await db.execute(sql`
          select count(*)::int as n from call_meeting
          where closer_user_id = ${me.id}
            and id in (${sql.join(asked.map((id) => sql`${id}`), sql`, `)})
        `)) as { n: number }[])
      : [];
    if (!asked || Number(mine[0]?.n) !== asked.length) {
      return Response.json(
        { error: "You can only brief the meetings you were given to close." },
        { status: 403 },
      );
    }
  }

  // Exactly what the page shows, through the one shared fragment: everything
  // ahead, plus anything whose time has passed that nobody has logged. A demo
  // visible on the page must always be one this can write a brief for.
  const ids =
    asked ??
    (
      (await db.execute(sql`
        select m.id from call_meeting m
        where ${briefScope}
        order by m.start_at asc
      `)) as unknown as Record<string, unknown>[]
    ).map((r) => Number(r.id));

  if (ids.length === 0) {
    return Response.json({ briefs: [], written: 0, reused: 0, failed: [] });
  }

  // First: read any booking call that was recorded and never transcribed.
  // Transcription is on demand everywhere else because it is billed per
  // minute — this is the one place somebody is definitely going to read it,
  // and without it the brief for that demo is a shrug. Before `briefSources`,
  // so the transcripts written here are the ones the briefs are built from
  // and the fingerprint covers them.
  const transcripts = await ensureTranscripts(ids);

  const sources = await briefSources(ids);

  const existing = (await db.execute(sql`
    select meeting_id, summary, source_fingerprint, generated_at
    from call_meeting_brief
    where meeting_id in (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )})
  `)) as unknown as Record<string, unknown>[];
  const stored = new Map(
    existing.map((r) => [
      Number(r.meeting_id),
      {
        summary: String(r.summary),
        fingerprint: (r.source_fingerprint as string | null) ?? null,
      },
    ]),
  );

  const failed: { meetingId: number; company: string; error: string }[] = [];
  let written = 0;
  let reused = 0;
  // Read out here: the worker below is a closure, and TypeScript drops the
  // narrowing from the `if (!me)` guard across one.
  const authorId = me.id;

  // A small pool rather than `Promise.all` over all fourteen — see CONCURRENCY.
  const queue = [...ids];
  async function worker() {
    for (;;) {
      const id = queue.shift();
      if (id === undefined) return;
      const source = sources.get(id);
      if (!source) continue;

      const fp = fingerprint(source);
      const have = stored.get(id);
      if (!force && have && have.fingerprint === fp) {
        reused += 1;
        continue;
      }

      try {
        const summary = await writeBrief(source);
        await db.execute(sql`
          insert into call_meeting_brief
            (meeting_id, summary, source_fingerprint, model, generated_by_user_id)
          values (${id}, ${summary}, ${fp}, ${"gpt-4.1-mini"}, ${authorId})
          on conflict (meeting_id) do update set
            summary = excluded.summary,
            source_fingerprint = excluded.source_fingerprint,
            model = excluded.model,
            generated_at = now(),
            generated_by_user_id = excluded.generated_by_user_id
        `);
        written += 1;
      } catch (err) {
        // Reported rather than thrown: one transcript the model chokes on must
        // not cost the other thirteen their briefing, and the screen can say
        // which name came back empty.
        console.error("[meeting-brief] failed", id, err);
        failed.push({
          meetingId: id,
          company: source.company,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker),
  );

  // The named meetings' briefs as they now stand, written or reused, for the
  // fold that asked. Not sent for the whole document, which reloads instead.
  const briefs = asked
    ? [...(await getStoredBriefs(asked))].map(([meetingId, b]) => ({
        meetingId,
        ...b,
      }))
    : undefined;

  return Response.json({
    written,
    reused,
    failed,
    total: ids.length,
    transcribed: transcripts.transcribed,
    transcribeFailed: transcripts.failed,
    briefs,
  });
}
