"use client";

import * as React from "react";
import { ChevronRight, FileText, RefreshCw } from "lucide-react";
import { briefLines, type StoredBrief } from "@/lib/brief-lines";

/**
 * The demo briefing, folded under a Meetings row (2026-09-24).
 *
 * Asked for so a founder does not have to leave the list for the Briefing page
 * before every demo. It shipped as that page alone, on the reasoning that the
 * list is a worklist and a brief is reading material; in practice the brief is
 * read in the minute before dialling, and the row being dialled from is where
 * that minute is spent. The page is still there for reading a run of demos in
 * one go, or printing them.
 *
 * - **Shows what is stored at once** — the list fetches every row's brief in
 *   one query — and **checks this one meeting when the fold is opened**: a
 *   brief is written there and then if there is none, and rewritten if a call
 *   has been logged on the lead since. The route hashes the material, so an
 *   unchanged brief costs nothing to check, and opening a fold is somebody
 *   asking to read it, which is when the cost is worth paying.
 * - Checked once per page view, not on every open and close.
 * - A native `details`, like the booking notes and the texts beside it: it
 *   opens before hydration, and the check hangs off its toggle.
 */
export function MeetingBriefFold({
  meetingId,
  initial,
}: {
  meetingId: number;
  /** The brief already written for this meeting, or null. */
  initial: StoredBrief | null;
}) {
  const [brief, setBrief] = React.useState<StoredBrief | null>(initial);
  const [state, setState] = React.useState<
    "idle" | "checking" | "writing" | "failed"
  >("idle");
  const [problem, setProblem] = React.useState<string | null>(null);
  const asked = React.useRef(false);

  // A newer brief arriving from the server — written from the Briefing page,
  // or by somebody else — replaces the one held here. Adjusted during render
  // rather than in an effect, and only ever forwards: a refresh must not put
  // back an older brief than the one this fold has just written.
  const [seenAt, setSeenAt] = React.useState(initial?.generatedAt ?? null);
  if ((initial?.generatedAt ?? null) !== seenAt) {
    setSeenAt(initial?.generatedAt ?? null);
    if (initial && (!brief || initial.generatedAt > brief.generatedAt)) {
      setBrief(initial);
    }
  }

  async function check() {
    setProblem(null);
    setState(brief ? "checking" : "writing");
    try {
      const res = await fetch("/api/meetings/brief", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ meetingIds: [meetingId] }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        briefs?: ({ meetingId: number } & StoredBrief)[];
        failed?: { error: string }[];
      } | null;
      if (!res.ok) {
        setProblem(data?.error ?? "Could not write the briefing.");
        setState("failed");
        return;
      }
      const got = data?.briefs?.find((b) => b.meetingId === meetingId);
      if (got) setBrief({ summary: got.summary, generatedAt: got.generatedAt });
      if (data?.failed && data.failed.length > 0) {
        // The route only rewrites a brief whose material has moved, so one
        // that failed to rewrite is out of date — said, rather than leaving an
        // older brief looking current.
        setProblem(
          brief
            ? "Could not bring this up to date, so it may be missing the latest call."
            : "The briefing could not be written this time.",
        );
        setState("failed");
        return;
      }
      setState("idle");
    } catch {
      setProblem("Could not reach the server.");
      setState("failed");
    }
  }

  return (
    <details
      className="group mt-3 rounded-lg border bg-muted/30"
      onToggle={(e) => {
        if (!e.currentTarget.open || asked.current) return;
        asked.current = true;
        void check();
      }}
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-[13px] font-semibold">
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
        Briefing
        <span
          className="font-normal text-muted-foreground"
          suppressHydrationWarning
        >
          {brief ? `written ${ago(brief.generatedAt)}` : "not written yet"}
        </span>
      </summary>
      <div className="border-t px-3 py-2.5">
        {brief ? (
          <ul className="space-y-1">
            {briefLines(brief.summary).map((line, i) => (
              <li key={i} className="flex gap-2 text-[13px] leading-snug">
                <span className="select-none text-muted-foreground">&bull;</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        ) : state === "writing" ? (
          <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <RefreshCw className="size-3.5 shrink-0 animate-spin" />
            Reading the booking call and writing the briefing. This takes a
            few seconds.
          </p>
        ) : state !== "failed" ? (
          <p className="text-[13px] text-muted-foreground">
            Opening this writes the briefing from the booking call.
          </p>
        ) : null}

        {brief && state === "checking" && (
          <p className="mt-2 flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <RefreshCw className="size-3 shrink-0 animate-spin" />
            Checking for anything logged since it was written…
          </p>
        )}
        {state === "failed" && (
          <p className="mt-2 text-[12px] text-destructive">
            {problem}{" "}
            <button
              type="button"
              onClick={() => void check()}
              className="font-semibold underline underline-offset-2"
            >
              Try again
            </button>
          </p>
        )}
        {brief && (
          <p className="mt-2 text-[12px] text-muted-foreground">
            Written by a machine from the booking call, so check anything
            before you repeat it back to them.
          </p>
        )}
      </div>
    </details>
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
