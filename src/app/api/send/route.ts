import { eq } from "drizzle-orm";
import { db } from "@/db";
import { contact, message, sendingAccount } from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";
import { sendGmail, SmtpAuthError, SmtpBlockedError } from "@/lib/gmail";
import { getSession } from "@/lib/session";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    contactId?: unknown;
    accountId?: unknown;
    subject?: unknown;
    body?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const contactId = Number(body.contactId);
  const accountId = Number(body.accountId);
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!Number.isInteger(contactId) || !Number.isInteger(accountId)) {
    return Response.json(
      { error: "contactId and accountId are required." },
      { status: 400 },
    );
  }
  if (subject === "" || text === "") {
    return Response.json(
      { error: "Subject and body are both required." },
      { status: 400 },
    );
  }

  const [[recipient], [account]] = await Promise.all([
    db
      .select({ id: contact.id, email: contact.email })
      .from(contact)
      .where(eq(contact.id, contactId)),
    db
      .select({
        id: sendingAccount.id,
        email: sendingAccount.email,
        appPassword: sendingAccount.appPassword,
        active: sendingAccount.active,
      })
      .from(sendingAccount)
      .where(eq(sendingAccount.id, accountId)),
  ]);
  if (!recipient) {
    return Response.json({ error: "Contact not found." }, { status: 404 });
  }
  if (!account) {
    return Response.json({ error: "Sending account not found." }, { status: 404 });
  }
  if (!account.active) {
    return Response.json(
      { error: `${account.email} is deactivated.` },
      { status: 400 },
    );
  }
  if (!account.appPassword) {
    return Response.json(
      { error: `${account.email} has no stored app password.` },
      { status: 400 },
    );
  }

  try {
    const { rfcMessageId } = await sendGmail({
      fromEmail: account.email,
      appPassword: decryptSecret(account.appPassword),
      to: recipient.email,
      subject,
      text,
    });

    const [row] = await db
      .insert(message)
      .values({
        accountId: account.id,
        direction: "out",
        kind: "sent",
        // gmail_message_id is Gmail's internal id — not exposed over SMTP.
        // The Phase 5 IMAP poller can backfill it via X-GM-MSGID if needed.
        gmailMessageId: null,
        rfcMessageId,
        subject,
        bodyText: text,
        sentAt: new Date(),
      })
      .returning({ id: message.id });

    return Response.json({ ok: true, messageRowId: row.id, rfcMessageId });
  } catch (err) {
    if (err instanceof SmtpBlockedError || err instanceof SmtpAuthError) {
      return Response.json({ error: err.message }, { status: 502 });
    }
    throw err;
  }
}
