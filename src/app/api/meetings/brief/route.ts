import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/session";
import {
  briefConfigured,
  briefSources,
  ensureTranscripts,
  fingerprint,
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
 */

/** How many to write at once. Fourteen sequential calls is half a minute of
 *  somebody watching a spinner; fourteen at once is a burst OpenAI may rate
 *  limit and a failure mode that looks like the feature being broken. */
const CONCURRENCY = 4;

export async function POST(request: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin") {
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
  } | null;
  const force = body?.force === true;

  // The same set the screen calls upcoming: accepted demos still ahead of us.
  // Cancelled ones are not walked into and a past one needs no briefing.
  const upcoming = (await db.execute(sql`
    select id from call_meeting
    where status = 'accepted' and start_at > now()
    order by start_at asc
  `)) as unknown as Record<string, unknown>[];
  const ids = upcoming.map((r) => Number(r.id));

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

  return Response.json({
    written,
    reused,
    failed,
    total: ids.length,
    transcribed: transcripts.transcribed,
    transcribeFailed: transcripts.failed,
  });
}
