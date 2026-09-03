"use client";

import * as React from "react";
import { useTelnyxCall } from "./use-telnyx-call";
import { IncomingCall } from "./incoming-call";
import { useLineClaimed, useLineLeader } from "./line-presence";

/**
 * Somebody ringing in while nobody is looking at a dialler.
 *
 * The dialler and the Keypad each register their own line, so a call arriving
 * on either of those screens is already answered there. Everywhere else in the
 * Call CRM — Callbacks, Meetings, the Spreadsheet, Stats — nothing was
 * registered, so an inbound call reached nobody and rang out with no voicemail
 * behind it. A prospect ringing back at the wrong moment simply vanished.
 *
 * This registers on every other screen and hands the call the same banner.
 *
 * **It stands down when a screen owns the line.** Two registrations against one
 * credential means Telnyx forks the invite to both, so a caller on the dialler
 * would get two banners for one call and could answer the wrong one. The
 * dialler and the Keypad claim the line while they are mounted (see
 * `line-presence.tsx`); this only registers when nothing has.
 */
const AUDIO_ID = "cylrm-inbound-audio";

export function InboundListener({
  /** False for anyone who dials from a handset, and for anyone with no caller
   *  ID: without a number there is nothing for a prospect to ring back. */
  enabled,
}: {
  enabled: boolean;
}) {
  const claimed = useLineClaimed();
  // One registration per browser, not per tab. Without this every open Call
  // CRM tab registered against the same credential.
  const leader = useLineLeader();
  const line = useTelnyxCall(AUDIO_ID, enabled && !claimed && leader);

  return (
    <>
      {line.incoming && (
        // Fixed rather than in the flow: this can arrive over any screen in the
        // workspace, most of which know nothing about calls and have no place
        // to put a banner. Above the content and below nothing.
        <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-3">
          <div className="pointer-events-auto w-full max-w-md">
            <IncomingCall key={line.incoming.from} incoming={line.incoming} />
          </div>
        </div>
      )}
      {/* The far end's audio has to land somewhere on these screens too. */}
      <audio id={AUDIO_ID} autoPlay />
    </>
  );
}
