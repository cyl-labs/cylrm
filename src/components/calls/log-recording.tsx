"use client";

import * as React from "react";
import { CirclePlay } from "lucide-react";
import { RecordingSheet } from "@/components/calls/recording-sheet";

function mmss(ms: number) {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * The "listen back" control on one row of the call log.
 *
 * Its own component because the Stats page is a server component and the sheet
 * is not: this is the smallest thing that has to be client-side, so the table
 * around it stays on the server.
 *
 * One sheet per row rather than one for the table with a selected id, which
 * would mean lifting state into a client component wrapping the whole log.
 * The sheet renders nothing at all until it is opened, so three hundred of
 * these cost three hundred closed dialogs — and `preload="none"` on the audio
 * means no Telnyx request is made until someone presses play.
 */
export function LogRecording({
  recordingId,
  recordingMs,
  company,
  callerName,
  mine = false,
}: {
  recordingId: string;
  recordingMs: number | null;
  company: string;
  /** Whose call this was. The transcript labels the near side with it, since
   *  an admin reading the floor's calls is not "You". */
  callerName: string;
  /** Reading your own call, on your own Stats. The name then says nothing —
   *  every row on that screen is yours — so it comes off the sheet's subtitle,
   *  and the transcript calls the near side "You" instead. */
  mine?: boolean;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      {/* Says "Listen back", not just the length. It shipped as a bare "1:21"
          under the timestamp, which reads as another timestamp: the one thing
          on this row that does something had nothing on it saying so. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
      >
        <CirclePlay className="size-3.5" strokeWidth={2} />
        Listen back
        {recordingMs && (
          <span className="font-medium text-muted-foreground">
            {mmss(recordingMs)}
          </span>
        )}
      </button>
      {open && (
        <RecordingSheet
          recordingId={recordingId}
          recordingMs={recordingMs}
          title={company}
          subtitle={mine ? null : callerName}
          callerLabel={mine ? "You" : callerName}
          open
          onOpenChange={setOpen}
        />
      )}
    </>
  );
}
