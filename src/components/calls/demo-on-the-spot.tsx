"use client";

import * as React from "react";
import { FileSignature, Loader2, MessageSquare, Send } from "lucide-react";
import { toast } from "sonner";
import type { Meeting } from "@/lib/meetings";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PrepareContracts } from "@/components/calls/prepare-contracts";

const MAX_LENGTH = 480;

/**
 * Contracts and a text for a demo that is happening on the cold call itself
 * (2026-10-10).
 *
 * A closer conferences the demo line into a cold call and runs the demo there
 * and then, so there is no Cal.com booking and no row on Meetings for the
 * contracts and the text to hang off. Pressing the button makes the same silent
 * meeting the Spreadsheet can (`POST /api/meetings` with `now`), handed to the
 * closer pressing it, and everything below is the Meetings screen's own: the
 * contract dialog, the signing-link chips and `POST /api/meetings/[id]/text`.
 * Nothing here is a second implementation, so a rule changed there changes here.
 *
 * The meeting is held in the browser and fetched again after each change,
 * because the dialler moves between leads without a page load and the
 * server-rendered Meetings list is not on this screen to refresh.
 */
export function DemoOnTheSpot({
  leadId,
  tz,
  signingBase,
  canText,
  canDiscard,
  senderName,
}: {
  leadId: number;
  /** The reader's clock, for the contract's effective date. */
  tz: string;
  signingBase: string;
  /** Texting is on and this person has the Team permission to send. */
  canText: boolean;
  canDiscard: boolean;
  /** First name the text signs as. */
  senderName: string;
}) {
  const [meeting, setMeeting] = React.useState<Meeting | null>(null);
  const [starting, setStarting] = React.useState(false);
  const [body, setBody] = React.useState("");
  const [sending, setSending] = React.useState(false);

  const load = React.useCallback(async (id: number): Promise<Meeting | null> => {
    const res = await fetch(`/api/meetings/${id}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Could not open the demo.");
      return null;
    }
    const data = (await res.json()) as { meeting: Meeting };
    setMeeting(data.meeting);
    return data.meeting;
  }, []);

  async function start() {
    setStarting(true);
    try {
      const res = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, now: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Could not start the demo.");
        return;
      }
      const m = await load(data.id);
      if (m) {
        const first = m.attendeeName?.trim().split(/\s+/)[0];
        setBody(
          `${first ? `Hey ${first}` : "Hey"}, it's ${senderName} sending over the docs right now, let me know if you have any questions.`,
        );
      }
    } catch {
      toast.error("Could not start the demo: network error.");
    } finally {
      setStarting(false);
    }
  }

  async function send() {
    if (!meeting) return;
    setSending(true);
    try {
      const res = await fetch(`/api/meetings/${meeting.id}/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: body }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Could not send the text.");
        return;
      }
      toast.success(`Texted ${meeting.attendeeName ?? meeting.company ?? "them"}`);
      setBody("");
    } catch {
      // The request may have reached the server before the connection went, so
      // this must not read as "nothing happened, press it again".
      toast.error(
        "Lost the connection while sending, so it may or may not have gone. Check the Texts screen before sending again.",
      );
    } finally {
      setSending(false);
    }
  }

  function addLink(url: string) {
    setBody((prev) => {
      const t = prev.trimEnd();
      return t ? `${t}\n${url}` : url;
    });
  }

  if (!meeting) {
    return (
      <div className="mt-3 w-full rounded-xl border border-dashed px-3 py-3 text-left">
        <p className="text-[13px] font-semibold">Doing the demo on this call?</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          This puts the demo on your Meetings screen so you can draft their
          contracts and text them the links while you are still talking. They
          are not emailed or texted anything until you send it.
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-2 h-10 w-full gap-2"
          onClick={start}
          disabled={starting}
        >
          {starting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <FileSignature className="size-4" />
          )}
          Contracts and text for this demo
        </Button>
      </div>
    );
  }

  const drafted = meeting.contracts;

  return (
    <div className="mt-3 w-full rounded-xl border px-3 py-3 text-left">
      <p className="text-[13px] font-semibold">Demo on this call</p>
      <p className="mt-0.5 text-[13px] text-muted-foreground">
        Draft the agreements first, then text the signing links. Nothing is sent
        to them until you press Send on the text.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <PrepareContracts
          meeting={meeting}
          tz={tz}
          signingBase={signingBase}
          canDiscard={canDiscard}
          onChange={() => void load(meeting.id)}
        />
      </div>

      {canText && (
        <div className="mt-3">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold">
            <MessageSquare className="size-3.5" />
            Text them
          </p>
          {drafted.length > 0 && signingBase && (
            <div className="mt-1.5 flex flex-wrap gap-2">
              {drafted.map((c) => (
                <Button
                  key={c.kind}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => addLink(`${signingBase}/s/${c.signerSlug}`)}
                >
                  Add {c.kind === "trial" ? "trial" : "paid"} link
                </Button>
              ))}
            </div>
          )}
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={MAX_LENGTH}
            className="mt-2 min-h-[88px]"
            placeholder="Write the text. It goes out from your own number."
          />
          <Button
            type="button"
            className="mt-2 h-10 w-full gap-2"
            onClick={send}
            disabled={sending || !body.trim()}
          >
            {sending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            Send text
          </Button>
        </div>
      )}
    </div>
  );
}
