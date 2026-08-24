"use client";

import * as React from "react";
import { AudioLines } from "lucide-react";
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
}: {
  recordingId: string;
  recordingMs: number | null;
  company: string;
  /** Whose call this was. The transcript labels the near side with it, since
   *  an admin reading the floor's calls is not "You". */
  callerName: string;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
      >
        <AudioLines className="size-3" />
        {recordingMs ? mmss(recordingMs) : "Listen back"}
      </button>
      {open && (
        <RecordingSheet
          recordingId={recordingId}
          recordingMs={recordingMs}
          title={company}
          subtitle={callerName}
          callerLabel={callerName}
          open
          onOpenChange={setOpen}
        />
      )}
    </>
  );
}
