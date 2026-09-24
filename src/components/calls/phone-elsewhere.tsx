"use client";

import { useLineElsewhere } from "./line-presence";

/**
 * What a screen that dials says when another CRM tab has the phone, with the
 * one tap that brings it here (2026-09-24).
 *
 * It used to say only "Dial from there, or close it and reload", which assumes
 * the reader can tell which tab "there" is and why it won. A founder at the
 * start of a demo could not: the other tab was sitting on Scripts, which cannot
 * dial at all. Now the reason is named — a call in progress, or just holding
 * the line — and the fix is a button rather than a hunt through windows.
 *
 * Inline, so it can sit inside the line of text a screen already has there.
 */
export function PhoneElsewhere() {
  const { elsewhere, take } = useLineElsewhere();
  const onCall = elsewhere === "call";
  return (
    <span>
      {onCall
        ? "Another CRM tab is on a call, so the phone is there. "
        : "The phone is in another CRM tab. "}
      <button
        type="button"
        onClick={() => {
          // Taking it from a tab on a call ends that call, so that one is
          // asked first. Holding the line with nothing on it costs nothing to
          // take, so that one is not.
          if (
            onCall &&
            !window.confirm(
              "This ends the call in the other CRM tab. Take the phone here?",
            )
          ) {
            return;
          }
          take();
        }}
        className="ml-0.5 inline-flex items-center rounded-md border px-2 py-0.5 font-semibold text-foreground transition-colors hover:bg-muted"
      >
        {onCall ? "Take it here" : "Use the phone here"}
      </button>
    </span>
  );
}
