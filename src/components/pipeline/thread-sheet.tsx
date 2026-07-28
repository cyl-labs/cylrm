"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type ThreadMessage = {
  id: number;
  direction: "out" | "in";
  kind: "sent" | "reply" | "auto_reply" | "bounce";
  stepNumber: number | null;
  subject: string | null;
  unsubscribeIntent?: boolean;
  bodyText: string | null;
  sentAt: string | null;
  accountEmail: string;
};

type ThreadData = {
  deal: { id: number; stage: string };
  contact: { id: number; email: string; name: string | null; company: string | null };
  campaign: { id: number; name: string };
  enrollment: { id: number; status: string } | null;
  unsubscribed: boolean;
  messages: ThreadMessage[];
};

const KIND_LABEL: Record<ThreadMessage["kind"], string> = {
  sent: "Sent",
  reply: "Reply",
  auto_reply: "Auto-reply",
  bounce: "Bounce",
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function ThreadSheet({
  dealId,
  onOpenChange,
}: {
  dealId: number | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [data, setData] = React.useState<ThreadData | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async (id: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/deals/${id}/thread`);
      if (res.ok) setData(await res.json());
      else toast.error("Failed to load thread.");
    } catch {
      toast.error("Failed to load thread — network error.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (dealId !== null) {
      setData(null);
      load(dealId);
    }
  }, [dealId, load]);

  async function unsubscribe() {
    if (!data || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId: data.contact.id }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Unsubscribe failed.");
        return;
      }
      toast.success(
        body.alreadyUnsubscribed
          ? `${body.email} was already unsubscribed.`
          : `${body.email} unsubscribed${body.cancelled > 0 ? `, ${body.cancelled} enrollment(s) cancelled` : ""}.`,
      );
      load(data.deal.id);
      router.refresh();
    } catch {
      toast.error("Unsubscribe failed — network error.");
    } finally {
      setBusy(false);
    }
  }

  async function markAutoReply(messageId: number) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/messages/${messageId}/mark-auto-reply`, {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Reclassify failed.");
        return;
      }
      toast.success(
        "Marked as auto-reply — deal removed, enrollment paused 7 days.",
      );
      onOpenChange(false);
      router.refresh();
    } catch {
      toast.error("Reclassify failed — network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={dealId !== null} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-lg">
        <SheetHeader className="shrink-0">
          <SheetTitle>
            {data ? (data.contact.name ?? data.contact.email) : "Thread"}
          </SheetTitle>
          <SheetDescription>
            {data ? (
              <>
                {data.contact.email}
                {data.contact.company ? ` · ${data.contact.company}` : ""} ·{" "}
                <Badge variant="outline" className="align-middle text-[11px]">
                  {data.campaign.name}
                </Badge>
              </>
            ) : (
              "Loading…"
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {loading && (
            <p className="text-[13px] text-muted-foreground">Loading thread…</p>
          )}
          {!loading && data && data.messages.length === 0 && (
            <p className="text-[13px] text-muted-foreground">
              No messages recorded for this enrollment.
            </p>
          )}
          {data?.messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                "rounded-lg border p-3",
                m.direction === "in" ? "bg-primary/5" : "bg-card",
              )}
            >
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">
                  {m.direction === "out"
                    ? `${m.accountEmail} →`
                    : `→ ${m.accountEmail}`}
                </span>
                <Badge
                  variant="secondary"
                  className={cn(
                    "text-[10px]",
                    m.kind === "bounce" && "bg-destructive/10 text-destructive",
                    m.kind === "reply" && "bg-success/10 text-success",
                  )}
                >
                  {KIND_LABEL[m.kind]}
                  {m.stepNumber ? ` · step ${m.stepNumber}` : ""}
                </Badge>
                {m.unsubscribeIntent && (
                  <Badge className="bg-warning/10 text-[10px] text-warning">
                    asks to be removed
                  </Badge>
                )}
                {m.sentAt && <span>{dateFormatter.format(new Date(m.sentAt))}</span>}
              </div>
              {m.subject && (
                <p className="mt-1.5 text-[13px] font-medium">{m.subject}</p>
              )}
              <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">
                {m.bodyText ?? "(content not captured for this message)"}
              </p>
              {m.direction === "in" && m.kind === "reply" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  disabled={busy}
                  onClick={() => markAutoReply(m.id)}
                >
                  Mark as auto-reply
                </Button>
              )}
            </div>
          ))}
        </div>

        {data && (
          <div className="flex shrink-0 items-center justify-between gap-2 border-t px-4 py-3">
            <span className="text-xs text-muted-foreground">
              Enrollment: {data.enrollment?.status ?? "none"} · Deal stage:{" "}
              {data.deal.stage.replace("_", " ")}
            </span>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy || data.unsubscribed}
              onClick={unsubscribe}
            >
              {data.unsubscribed ? "Unsubscribed" : "Unsubscribe"}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
