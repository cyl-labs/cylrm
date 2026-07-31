"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { stripUnsubscribeFooter, trimReplyBody } from "@/lib/reply-text";
import type { ReplyRow } from "@/lib/replies";

const KIND_LABEL: Record<ReplyRow["kind"], string> = {
  reply: "Reply",
  auto_reply: "Out of office",
  bounce: "Bounce",
};

const KIND_CLASS: Record<ReplyRow["kind"], string> = {
  reply: "bg-success/10 text-success",
  auto_reply: "bg-warning/10 text-warning",
  bounce: "bg-destructive/10 text-destructive",
};

const when = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
};

/** First line or two, so the list scans without opening anything. */
const snippet = (body: string) => body.replace(/\s+/g, " ").trim().slice(0, 150);

export function RepliesList({ replies }: { replies: ReplyRow[] }) {
  const router = useRouter();
  const [openId, setOpenId] = React.useState<number | null>(null);
  const [fullId, setFullId] = React.useState<number | null>(null);
  const [kind, setKind] = React.useState("all");
  const [campaignId, setCampaignId] = React.useState("all");
  const [readLocally, setReadLocally] = React.useState<Set<number>>(new Set());

  const campaigns = React.useMemo(() => {
    const seen = new Map<number, string>();
    for (const r of replies) seen.set(r.campaignId, r.campaignName);
    return [...seen.entries()];
  }, [replies]);

  const shown = replies.filter(
    (r) =>
      (kind === "all" || r.kind === kind) &&
      (campaignId === "all" || String(r.campaignId) === campaignId),
  );

  const isRead = (r: ReplyRow) => r.readAt !== null || readLocally.has(r.id);
  const unread = replies.filter((r) => !isRead(r)).length;

  async function open(r: ReplyRow) {
    const next = openId === r.id ? null : r.id;
    setOpenId(next);
    if (next !== null && !isRead(r)) {
      setReadLocally((prev) => new Set(prev).add(r.id));
      try {
        await fetch(`/api/replies/${r.id}/read`, { method: "POST" });
        router.refresh();
      } catch {
        // The optimistic mark stands; the next load will correct it.
      }
    }
  }

  if (replies.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 py-16">
        <h2 className="text-sm font-semibold tracking-[-0.01em]">
          No replies yet
        </h2>
        <p className="mt-1.5 max-w-sm text-center text-[13px] leading-relaxed text-muted-foreground">
          Anything a contact sends back — replies, out-of-office notices and
          bounces — appears here within five minutes of arriving.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger size="sm" className="w-full sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Everything</SelectItem>
            <SelectItem value="reply">Replies only</SelectItem>
            <SelectItem value="auto_reply">Out of office</SelectItem>
            <SelectItem value="bounce">Bounces</SelectItem>
          </SelectContent>
        </Select>
        {campaigns.length > 0 && (
          <Select value={campaignId} onValueChange={setCampaignId}>
            <SelectTrigger size="sm" className="w-full sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All campaigns</SelectItem>
              {campaigns.map(([id, name]) => (
                <SelectItem key={id} value={String(id)}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <span className="ml-auto text-[13px] text-muted-foreground">
          {unread > 0 ? `${unread} unread · ` : ""}
          {shown.length.toLocaleString()} shown
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {shown.map((r) => {
          const read = isRead(r);
          const expanded = openId === r.id;
          const written = trimReplyBody(r.body);
          const showingFull = fullId === r.id;
          return (
            <div
              key={r.id}
              className={cn(
                "rounded-lg border",
                !read && "border-primary/40 bg-primary/[0.03]",
              )}
            >
              <button
                type="button"
                onClick={() => open(r)}
                className="flex w-full flex-col gap-1.5 px-4 py-3 text-left"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {!read && (
                    <span className="size-1.5 shrink-0 rounded-full bg-primary" />
                  )}
                  <span
                    className={cn(
                      "text-[13px]",
                      read ? "font-medium" : "font-semibold",
                    )}
                  >
                    {r.contactName ?? r.contactEmail}
                  </span>
                  {r.company && (
                    <span className="text-[13px] text-muted-foreground">
                      {r.company}
                    </span>
                  )}
                  <Badge className={cn("text-[10px]", KIND_CLASS[r.kind])}>
                    {KIND_LABEL[r.kind]}
                  </Badge>
                  {r.unsubscribeIntent && (
                    <Badge className="bg-warning/10 text-[10px] text-warning">
                      asks to be removed
                    </Badge>
                  )}
                  <span className="ml-auto whitespace-nowrap text-[11px] text-muted-foreground">
                    {when(r.receivedAt)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                  <Badge variant="outline" className="text-[10px]">
                    {r.campaignName}
                  </Badge>
                  {r.repliedToStep !== null && (
                    <span>answering step {r.repliedToStep}</span>
                  )}
                  {/* Which arm of the copy test they got — only shown while a
                      test is actually running on this campaign. */}
                  {r.variant && (
                    <Badge variant="outline" className="text-[10px]">
                      Version {r.variant.toUpperCase()}
                      {r.variantLabel ? ` · ${r.variantLabel}` : ""}
                    </Badge>
                  )}
                  {r.mailbox && <span>· to {r.mailbox}</span>}
                </div>
                {!expanded && written.text && (
                  <p className="line-clamp-2 text-[13px] text-muted-foreground">
                    {snippet(written.text)}
                  </p>
                )}
              </button>

              {expanded && (
                <div className="space-y-4 border-t px-4 py-3">
                  <div>
                    <p className="text-[11px] font-medium text-muted-foreground">
                      {r.contactEmail} wrote
                      {r.subject ? ` — ${r.subject}` : ""}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-[13px]">
                      {(showingFull ? r.body?.trim() : written.text) ||
                        "(no text content)"}
                    </p>
                    {written.trimmed && (
                      <button
                        type="button"
                        onClick={() => setFullId(showingFull ? null : r.id)}
                        className="mt-1.5 text-[11px] font-medium text-muted-foreground underline underline-offset-2"
                      >
                        {showingFull
                          ? "Hide quoted text and signature"
                          : "Show full message"}
                      </button>
                    )}
                  </div>
                  <details className="rounded-lg bg-muted/50 p-3">
                    <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">
                      {r.repliedToStep !== null
                        ? `They were answering step ${r.repliedToStep}`
                        : "The email they were answering"}
                      {r.repliedToSubject ? ` — ${r.repliedToSubject}` : ""}
                    </summary>
                    <p className="mt-1 whitespace-pre-wrap text-[13px] text-muted-foreground">
                      {r.repliedToBody
                        ? stripUnsubscribeFooter(r.repliedToBody).trim()
                        : "(not recorded)"}
                    </p>
                  </details>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/campaigns/${r.campaignId}`}>
                      Open {r.campaignName}
                    </Link>
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
