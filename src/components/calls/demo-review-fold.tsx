"use client";

import * as React from "react";
import { ChevronRight, ClipboardCheck, RefreshCw } from "lucide-react";
import type { StageRating, StoredReview } from "@/lib/demo-review-types";

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
}: {
  meetingId: number;
  initial: StoredReview | null;
}) {
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
        body: JSON.stringify({ meetingId, force }),
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
        How the demo call went
        <span className="font-normal text-muted-foreground" suppressHydrationWarning>
          {stored ? `reviewed ${ago(stored.generatedAt)}` : "not reviewed yet"}
        </span>
      </summary>
      <div className="space-y-3 border-t px-3 py-2.5 text-[13px] leading-snug">
        {!r ? (
          <p className="text-muted-foreground">
            This scores the demo call against the sales method your mentor
            taught (NEPQ and Challenger): what was done well, what was missed
            and what to say differently. It reads the recording, so it takes
            up to a minute the first time.
          </p>
        ) : (
          <>
            {r.headline && <p className="font-medium">{r.headline}</p>}
            <p className="text-[12px] text-muted-foreground">
              The closer spoke {r.talk.closerPercent}% of the words and asked{" "}
              {r.talk.closerQuestions}{" "}
              {r.talk.closerQuestions === 1 ? "question" : "questions"} in{" "}
              {r.talk.minutes} minutes. In the data Gong studied, winning demos
              had the seller talking about two thirds of the time, so a high
              number is normal here. What hurts is long stretches with no back
              and forth.
            </p>

            {r.biggestFix && (
              <div className="rounded-md border border-primary/30 bg-primary/5 px-2.5 py-2">
                <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                  The one thing to change
                </p>
                <p className="mt-0.5">{r.biggestFix}</p>
              </div>
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

            <div>
              <p className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                Step by step
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

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(Boolean(r))}
            className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-[12px] font-semibold hover:bg-muted disabled:opacity-60"
          >
            {busy && <RefreshCw className="size-3 animate-spin" />}
            {busy
              ? "Reading the call…"
              : r
                ? "Review it again"
                : "Review this demo call"}
          </button>
          {problem && <span className="text-[12px] text-destructive">{problem}</span>}
        </div>
        {r && (
          <p className="text-[12px] text-muted-foreground">
            Written by a machine from the recording, so use it as a guide, not a
            final mark. Tone of voice cannot be judged from text.
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

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
