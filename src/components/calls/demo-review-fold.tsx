"use client";

import * as React from "react";
import { ChevronRight, ClipboardCheck, RefreshCw } from "lucide-react";
import type { ReviewCall, StageRating, StoredReview } from "@/lib/demo-review-types";

/**
 * The review of a demo call, folded under a Meetings row (2026-10-03).
 *
 * Shows what is stored at once. Writing one is always a press, because it costs
 * an OpenAI call and possibly a transcription: opening the fold never spends
 * anything by itself.
 */

const BADGE: Record<StageRating, { text: string; cls: string }> = {
  done: {
    text: "Did it",
    cls: "bg-success/15 text-success",
  },
  partly: {
    text: "Partly",
    cls: "bg-warning/20 text-warning-foreground dark:text-warning",
  },
  missed: { text: "Missed", cls: "bg-destructive/15 text-destructive" },
  not_reached: { text: "Not reached", cls: "bg-muted text-muted-foreground" },
};

export function DemoReviewFold({
  meetingId,
  initial,
  kind = "demo",
  calls = [],
  defaultIds = [],
}: {
  meetingId: number;
  initial: StoredReview | null;
  /** "demo" is the call a founder or closer ran; "booking" is the cold call a
   *  caller made to win it. */
  kind?: "demo" | "booking";
  /** Demo reviews: every recording of this business that could be the demo, so
   *  the reviewer chooses which to analyse (2026-10-03). The automatic pick is a
   *  guess, and a demo that drops is several recordings. */
  calls?: ReviewCall[];
  /** Ticked to begin with when nothing has been reviewed yet. */
  defaultIds?: string[];
}) {
  const booking = kind === "booking";
  const [picked, setPicked] = React.useState<string[]>(
    initial?.review.recordingIds && initial.review.recordingIds.length > 0
      ? initial.review.recordingIds
      : defaultIds,
  );
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const choosing = !booking && calls.length > 0;
  const [stored, setStored] = React.useState<StoredReview | null>(initial);
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [showAll, setShowAll] = React.useState(false);

  async function run(force: boolean) {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch("/api/meetings/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(booking ? { meetingId, force, kind } : { meetingId, force, kind, recordingIds: picked }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        stored?: StoredReview | null;
        reused?: boolean;
      } | null;
      if (!res.ok) {
        setProblem(data?.error ?? "Could not write the review.");
      } else if (data?.stored) {
        setStored(data.stored);
        if (data.reused) {
          setProblem("Nothing has changed on this call since the last review.");
        }
      }
    } catch {
      setProblem("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const r = stored?.review;
  const stages = r?.stages ?? [];
  const shown = showAll ? stages : stages.filter((s) => s.rating !== "not_reached");

  return (
    <details className="group mt-3 rounded-lg border bg-muted/30">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-[13px] font-semibold">
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <ClipboardCheck className="size-3.5 shrink-0 text-muted-foreground" />
        {booking ? "How the booking call went" : "How the demo call went"}
        <span className="font-normal text-muted-foreground" suppressHydrationWarning>
          {stored ? `reviewed ${ago(stored.generatedAt)}` : "not reviewed yet"}
        </span>
      </summary>
      <div className="space-y-3 border-t px-3 py-2.5 text-[13px] leading-snug">
        {!r ? (
          <p className="text-muted-foreground">
            {booking
              ? "A review of the cold call that booked this demo. It shows what went well, what to do better, and what to say next time. The first review can take up to a minute."
              : "A review of this demo. It shows what went well, what to do better, and what to say next time. The first review can take up to a minute."}
          </p>
        ) : (
          <>
            {r.headline && <p className="font-medium">{r.headline}</p>}
            <p className="text-[12px] text-muted-foreground">
              {booking ? "The caller" : "The closer"} spoke {r.talk.closerPercent}% of the words and asked{" "}
              {r.talk.closerQuestions}{" "}
              {r.talk.closerQuestions === 1 ? "question" : "questions"} in{" "}
              {r.talk.minutes} minutes.{" "}
              {booking
                ? "On cold calls that book a demo, the caller talks about half the time. If the caller talks much more, the owner may not get a turn."
                : "In good demos, the seller talks about two thirds of the time. So a lot of talking is fine. Long stretches with no back and forth are not."}
            </p>

            {r.nextSteps && r.nextSteps.length > 0 ? (
              <div className="rounded-md border border-primary/30 bg-primary/5 px-2.5 py-2">
                <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {booking ? "Do this on your next call" : "Do this on your next demo"}
                </p>
                <ol className="mt-1.5 space-y-2.5">
                  {r.nextSteps.map((st, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                        {i + 1}
                      </span>
                      <div className="min-w-0 space-y-0.5">
                        {st.when && <p className="text-muted-foreground">{st.when}</p>}
                        <p className="font-semibold">{st.do}</p>
                        <p>
                          <span className="text-muted-foreground">Say: </span>
                          &ldquo;{st.say}&rdquo;
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
              r.biggestFix && (
                <div className="rounded-md border border-primary/30 bg-primary/5 px-2.5 py-2">
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                    The one thing to change
                  </p>
                  <p className="mt-0.5">{r.biggestFix}</p>
                </div>
              )
            )}

            {r.wentWell.length > 0 && (
              <Section title="What went well">
                {r.wentWell.map((t, i) => (
                  <li key={i}>
                    <Bullet>{t}</Bullet>
                  </li>
                ))}
              </Section>
            )}

            {r.toImprove.length > 0 && (
              <Section title="What to change">
                {r.toImprove.map((t, i) => (
                  <li key={i} className="space-y-0.5">
                    <Bullet>{t.what}</Bullet>
                    {t.tryThis && (
                      <p className="ml-4 text-muted-foreground">
                        Try saying: &ldquo;{t.tryThis}&rdquo;
                      </p>
                    )}
                  </li>
                ))}
              </Section>
            )}

            {r.objections.length > 0 && (
              <Section title="When they pushed back">
                {r.objections.map((o, i) => (
                  <li key={i} className="space-y-0.5">
                    <Bullet>
                      They said &ldquo;{o.theySaid}&rdquo;. {o.handled}
                    </Bullet>
                    {o.tryThis && (
                      <p className="ml-4 text-muted-foreground">
                        Try: {o.tryThis}
                      </p>
                    )}
                  </li>
                ))}
              </Section>
            )}

            {r.ownerMoments && r.ownerMoments.length > 0 && (
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                  What the owner felt strongly about
                </p>
                <p className="mb-1 text-[12px] text-muted-foreground">
                  The owner&apos;s own words, in the order they said them. This is
                  about the owner, not a grade for the closer.
                </p>
                <ul className="space-y-1.5">
                  {r.ownerMoments.map((m, i) => (
                    <li key={i} className="rounded-md border bg-card px-2.5 py-1.5">
                      <p className="font-medium">&ldquo;{m.quote}&rdquo;</p>
                      <p className="mt-0.5">{m.feeling}</p>
                      <p className="mt-0.5 text-[12px] text-muted-foreground">
                        Then: {m.closerNext}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <p className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                How each step went
              </p>
              <ul className="space-y-1.5">
                {shown.map((s) => (
                  <li key={s.key} className="rounded-md border bg-card px-2.5 py-1.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${BADGE[s.rating].cls}`}
                      >
                        {BADGE[s.rating].text}
                      </span>
                      <span className="font-medium">{s.label}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {s.method}
                      </span>
                    </div>
                    {s.note && <p className="mt-0.5">{s.note}</p>}
                    {s.evidence && (
                      <p className="mt-0.5 text-[12px] text-muted-foreground">
                        &ldquo;{s.evidence}&rdquo;
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              {stages.some((s) => s.rating === "not_reached") && (
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="mt-1.5 text-[12px] font-semibold underline underline-offset-2"
                >
                  {showAll
                    ? "Hide the steps the call never reached"
                    : "Show the steps the call never reached"}
                </button>
              )}
            </div>
          </>
        )}

        {choosing && (
          <div className="rounded-md border bg-card px-2.5 py-2">
            <p className="text-[12px] font-semibold">Which calls should be reviewed?</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Tick the call that was the real demo. If it dropped and was
              redialled, tick every part. Anything that was only a voicemail or a
              missed call should be left unticked.
            </p>
            <ul className="mt-1.5 space-y-1">
              {calls.map((c) => (
                <li key={c.recordingId}>
                  <label className="flex cursor-pointer items-center gap-2 text-[12px]">
                    <input
                      type="checkbox"
                      checked={picked.includes(c.recordingId)}
                      onChange={() => toggle(c.recordingId)}
                      className="size-3.5"
                    />
                    <span className="font-medium">{c.label}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {fmtDuration(c.durationMs)}
                    </span>
                    {c.startedLabel && (
                      <span className="text-muted-foreground">{c.startedLabel}</span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
            {r?.recordingIds && r.recordingIds.length > 0 && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                The review above was written from {r.recordingIds.length}{" "}
                {r.recordingIds.length === 1 ? "call" : "calls"}.
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy || (choosing && picked.length === 0)}
            onClick={() => void run(Boolean(r))}
            className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-[12px] font-semibold hover:bg-muted disabled:opacity-60"
          >
            {busy && <RefreshCw className="size-3 animate-spin" />}
            {busy
              ? "Reading the call…"
              : choosing
                ? r
                  ? "Review again with the ticked calls"
                  : "Review the ticked calls"
                : r
                  ? "Review it again"
                  : booking
                    ? "Review this booking call"
                    : "Review this demo call"}
          </button>
          {problem && <span className="text-[12px] text-destructive">{problem}</span>}
        </div>
        {r && (
          <p className="text-[12px] text-muted-foreground">
            Made from the call text. It is a guide, not a grade. It cannot hear
            how someone sounded.
          </p>
        )}
      </div>
    </details>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <ul className="space-y-1">{children}</ul>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="select-none text-muted-foreground">&bull;</span>
      <span>{children}</span>
    </div>
  );
}

const fmtDuration = (ms: number | null) =>
  ms === null
    ? ""
    : `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}`;

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
