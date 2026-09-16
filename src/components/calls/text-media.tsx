import { Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Pictures and files on a text, and the one place that draws them.
 *
 * **Two screens show texts, which is why this is a component and not a block
 * of JSX.** The Texts screen has the full iMessage-shaped thread; each row on
 * Meetings carries the conversation with that business. They have separate
 * queries (`getThreadMessages` in `lib/texts.ts`, `getTextsByLead` in
 * `lib/sms.ts`) and separate bubbles, and when attachments shipped on
 * 2026-09-16 only the first one got them — a founder was still looking at
 * "[They sent a picture or file]" on Meetings an hour later. A third screen
 * that shows a text must render through this.
 *
 * It never receives a url. The stored one is a public Telnyx S3 object, so
 * the bytes come from `/api/texts/media/[id]`, which checks who is asking —
 * see `SmsMedia` in the schema for why that matters.
 */
export type TextAttachment = {
  contentType: string;
  size: number | null;
};

/** Where the bytes come from. Never Telnyx's own url, which needs no login. */
export const mediaHref = (messageId: number, index: number) =>
  `/api/texts/media/${messageId}?i=${index}`;

/** "1.2 MB". On a file row the only other honest thing to say about an
 *  attachment we are not rendering is its type. */
function fileSize(bytes: number | null) {
  if (!bytes) return null;
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * The words in a bubble that is also showing its attachment.
 *
 * `recordInboundText` writes "[They sent a picture or file]" into the body so
 * the conversation list has a preview line and a bubble is never empty. Once
 * the picture itself is on screen that sentence only describes what the reader
 * is already looking at, so it comes off — but only where something is
 * actually rendered in its place, which is why this takes `hasMedia` rather
 * than stripping unconditionally.
 */
export function bubbleText(body: string, hasMedia: boolean) {
  if (!hasMedia) return body;
  return body
    .split("\n")
    .filter((line) => !/^\[They sent .*\]$/.test(line.trim()))
    .join("\n")
    .trim();
}

export function TextMedia({
  messageId,
  media,
  /** The bubble behind this is a strong colour with white text, so a file row
   *  has to lift off it rather than sink into it. */
  onColour = false,
  /** There are words under it, so leave a gap. */
  spaced = false,
}: {
  messageId: number;
  media: TextAttachment[];
  onColour?: boolean;
  spaced?: boolean;
}) {
  if (media.length === 0) return null;
  return (
    <div className={cn("flex flex-col gap-1.5", spaced && "mb-1.5")}>
      {media.map((m, i) =>
        m.contentType.startsWith("image/") ? (
          // Opens full size in a tab: a photo of a job site or a signed page
          // is sent to be looked at closely, and the bubble is 78% of a column.
          <a
            key={i}
            href={mediaHref(messageId, i)}
            target="_blank"
            rel="noreferrer"
          >
            {/* eslint-disable-next-line @next/next/no-img-element --
                next/image wants a known host and fixed dimensions; this is our
                own route streaming bytes of unknown size. */}
            <img
              src={mediaHref(messageId, i)}
              alt="Attachment"
              className="max-h-80 w-full rounded-[12px] object-cover"
            />
          </a>
        ) : (
          <a
            key={i}
            href={mediaHref(messageId, i)}
            target="_blank"
            rel="noreferrer"
            className={cn(
              "flex items-center gap-2 rounded-[12px] px-3 py-2 text-[13px] underline",
              onColour ? "bg-white/20" : "bg-black/10 dark:bg-white/10",
            )}
          >
            <Paperclip className="size-4 shrink-0" />
            <span className="truncate">
              {m.contentType.split("/")[1]?.toUpperCase() ?? "File"}
              {fileSize(m.size) ? ` · ${fileSize(m.size)}` : ""}
            </span>
          </a>
        ),
      )}
    </div>
  );
}
