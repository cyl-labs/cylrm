/**
 * Push alerts for the things you would otherwise only find by going looking.
 *
 * Telegram, because it needs no domain, certificate, App Store review or
 * inbox — a bot token and a chat id in the environment and the phone buzzes.
 *
 * Everything here is best-effort and silent when unconfigured: the poller must
 * finish its tick whether or not Telegram is reachable, so a failure is
 * reported back in the poll result rather than thrown.
 */

/** Overridable so a dev test can point at a local sink, in the same spirit as
 * `GMAIL_SMTP_HOST`. Never set this in prod. */
const telegramApi = () =>
  process.env.TELEGRAM_API_BASE ?? "https://api.telegram.org";
const SEND_TIMEOUT_MS = 10_000;

/** Telegram rejects messages over 4096 characters. */
const MAX_BODY = 900;

export function notificationsConfigured(): boolean {
  return Boolean(
    process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID,
  );
}

async function send(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const res = await fetch(`${telegramApi()}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      // Plain text: Telegram still auto-links bare URLs, and no parse mode
      // means no way for a reply's own punctuation to break the message.
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Telegram ${res.status}: ${detail.slice(0, 200)}`);
  }
}

export type ReplyNotification = {
  contactName: string | null;
  contactEmail: string;
  company: string | null;
  campaignName: string;
  mailbox: string;
  subject: string | null;
  /** Already trimmed of quoted original and signature by the caller. */
  body: string | null;
  asksToBeRemoved: boolean;
  /** A/B arm, null when this campaign is not running a copy test. */
  variant: "a" | "b" | null;
  variantLabel: string | null;
};

export type MeetingNotification = {
  /** The last few minutes rather than the day before, so it gets the alarm. */
  urgent: boolean;
  /** Already worded: "Demo in 30 minutes, at 1:00 AM". */
  heading: string;
  who: string;
  /** "1:00 PM their time", or null when they share the founders' clock. */
  theirTime: string | null;
  contactName: string | null;
  bookedBy: string | null;
};

/** A demo coming up, to the founders' chat. */
export async function notifyMeeting(m: MeetingNotification): Promise<void> {
  const base = process.env.PUBLIC_APP_URL ?? "";
  const lines = [`${m.urgent ? "⏰" : "📅"} ${m.heading}: ${m.who}`];
  const details = [
    m.theirTime,
    m.contactName ? `with ${m.contactName}` : null,
    m.bookedBy ? `booked by ${m.bookedBy}` : null,
  ].filter(Boolean);
  if (details.length > 0) lines.push(details.join(" · "));
  if (base) lines.push("", `${base}/meetings`);
  await send(lines.join("\n"));
}

/**
 * The morning list of what is coming up, to the founders' chat.
 *
 * Deliberately one message with every meeting in it rather than the per-meeting
 * reminders repeated: this is the overview read with a coffee, and those are
 * the nudges that arrive when something is about to start.
 */
export async function notifyMeetingDigest(
  heading: string,
  lines: string[],
): Promise<void> {
  const base = process.env.PUBLIC_APP_URL ?? "";
  // A blank line between demos, and after the heading (2026-09-22, asked for
  // on the floor). Each line carries a time, a business, the prospect's own
  // clock and who booked it, so five of them stacked with no gap read as one
  // paragraph — Telegram wraps a long line on a phone, and the wrapped half
  // looked like the next meeting.
  const out = [`📋 ${heading}`, ...lines.flatMap((line) => ["", line])];
  if (base) out.push("", `${base}/meetings`);
  await send(out.join("\n"));
}

/** Fired when the poller files a genuine human reply. */
export async function notifyReply(r: ReplyNotification): Promise<void> {
  const who = r.contactName ?? r.contactEmail;
  const base = process.env.PUBLIC_APP_URL ?? "";
  const body = (r.body ?? "").trim();

  const lines = [
    `${r.asksToBeRemoved ? "🚫" : "📬"} Reply from ${who}${r.company ? `: ${r.company}` : ""}`,
    `${r.contactEmail} · ${r.campaignName} · to ${r.mailbox}`,
  ];
  if (r.variant) {
    lines.push(
      `Version ${r.variant.toUpperCase()}${r.variantLabel ? ` · ${r.variantLabel}` : ""}`,
    );
  }
  if (r.asksToBeRemoved) lines.push("Reads as an unsubscribe request.");
  if (r.subject) lines.push("", r.subject);
  if (body) {
    lines.push(
      "",
      body.length > MAX_BODY ? `${body.slice(0, MAX_BODY)}…` : body,
    );
  }
  if (base) lines.push("", `${base}/replies`);

  await send(lines.join("\n"));
}

/**
 * Calls that connected and lost their audio.
 *
 * Sent during the shift rather than as a nightly digest, because unlike the
 * callbacks and quota reports this is a fault that may still be happening —
 * on 2026-09-21 Telnyx's recording pipeline dropped 34 answered calls over two
 * and a half hours, and the value of knowing is entirely in knowing while it
 * is going on.
 *
 * Names the caller, because a gap is far more often one person's line than a
 * global outage: that day one connection lost calls while eight others
 * recorded normally, and the name is the most actionable word in the message.
 */
export async function notifyRecordingGap(g: {
  calls: number;
  seconds: number;
  who: string;
  more: number;
}): Promise<void> {
  const base = process.env.PUBLIC_APP_URL ?? "";
  const mins = Math.round(g.seconds / 60);
  const lines = [
    `🔇 ${g.calls} ${g.calls === 1 ? "call has" : "calls have"} no recording`,
    `${g.who}${g.more > 0 ? ` and ${g.more} more` : ""} · about ${mins} ${mins === 1 ? "minute" : "minutes"} of conversation`,
    "",
    "The calls connected and were billed; the audio never arrived. If this keeps climbing it is Telnyx's recording pipeline, not the callers. Check whether it is one line or all of them.",
  ];
  if (base) lines.push("", `${base}/calls`);
  await send(lines.join("\n"));
}
