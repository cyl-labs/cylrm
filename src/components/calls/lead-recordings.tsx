"use client";

import * as React from "react";
import { CirclePlay } from "lucide-react";
import type { CallOutcome } from "@/lib/calls";
import type { LeadRecording } from "@/lib/recordings";
import { OUTCOME_LABELS } from "@/components/calls/outcome";
import { RecordingSheet } from "@/components/calls/recording-sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** The Spreadsheet's clock for things we did, pinned for the reason
 *  `leads-grid.tsx` gives. */
const CALL_TZ = "Asia/Singapore";

function mmss(ms: number | null) {
  if (ms === null) return null;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function when(iso: string | null) {
  if (!iso) return "Unknown time";
  return new Date(iso).toLocaleString("en-US", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: CALL_TZ,
  });
}

/** What the call was, in the words the rest of the sheet uses. */
function what(r: LeadRecording) {
  if (r.direction === "in") return "They rang us";
  if (r.outcome && r.outcome in OUTCOME_LABELS) {
    return OUTCOME_LABELS[r.outcome as CallOutcome];
  }
  return r.keypad ? "Rung from the Keypad" : "No outcome linked";
}

/**
 * "Listen back" on a Spreadsheet row: every recording of a call with the
 * lead's number, newest first, each one playable.
 *
 * The list is fetched when opened, not shipped with the sheet. Keys and clicks
 * are stopped at the wrapper because the menu and the player are portals whose
 * React parent is a grid cell: without it, arrowing through the menu also
 * moved the sheet's selection underneath.
 */
export function LeadRecordings({
  leadId,
  count,
  title,
}: {
  leadId: number;
  count: number;
  title: string;
}) {
  const [items, setItems] = React.useState<LeadRecording[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [playing, setPlaying] = React.useState<LeadRecording | null>(null);

  async function load() {
    setFailed(false);
    try {
      const res = await fetch(`/api/call-leads/${leadId}/recordings`);
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { recordings: LeadRecording[] };
      setItems(data.recordings);
    } catch {
      setFailed(true);
    }
  }

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <span onKeyDown={stop} onClick={stop} onDoubleClick={stop}>
      <DropdownMenu
        onOpenChange={(open) => {
          if (open && items === null) void load();
        }}
      >
        <DropdownMenuTrigger className="flex items-center gap-1 rounded px-1 font-semibold text-primary hover:bg-primary/10">
          <CirclePlay className="size-3.5 shrink-0" strokeWidth={2} />
          Listen back
          <span className="tabular-nums text-muted-foreground">{count}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel className="text-[12px]">
            Calls with {title}
            <span className="block font-normal text-muted-foreground">
              Newest first, Singapore time
            </span>
          </DropdownMenuLabel>
          {failed ? (
            <p className="px-2 py-2 text-[13px] text-destructive">
              Couldn&apos;t load the recordings. Close this and try again.
            </p>
          ) : items === null ? (
            <p className="px-2 py-2 text-[13px] text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <p className="px-2 py-2 text-[13px] text-muted-foreground">
              No recordings you can open.
            </p>
          ) : (
            items.map((r) => (
              <DropdownMenuItem
                key={r.recordingId}
                // A tick later: the sheet opened while the menu is still closing
                // loses its focus to the menu.
                onSelect={() => setTimeout(() => setPlaying(r), 0)}
                className="flex-col items-start gap-0"
              >
                <span className="flex w-full items-center gap-1.5 text-[13px]">
                  <CirclePlay className="size-3.5 shrink-0 text-primary" strokeWidth={2} />
                  {when(r.startedAt)}
                  <span className="ml-auto tabular-nums text-muted-foreground">
                    {mmss(r.durationMs)}
                  </span>
                </span>
                <span className="pl-5 text-[12px] text-muted-foreground">
                  {[r.direction === "out" ? r.byName : null, what(r)]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {playing && (
        <RecordingSheet
          recordingId={playing.recordingId}
          recordingMs={playing.durationMs}
          title={title}
          subtitle={`${when(playing.startedAt)} · ${what(playing)}`}
          callerLabel={playing.byName ?? "Us"}
          open
          onOpenChange={(open) => !open && setPlaying(null)}
        />
      )}
    </span>
  );
}
