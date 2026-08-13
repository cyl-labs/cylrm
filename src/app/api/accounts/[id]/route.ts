import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { domain, enrollment, message, sendingAccount } from "@/db/schema";
import { encryptSecret } from "@/lib/crypto";
import { normalizeAppPassword, verifyGmailAppPassword } from "@/lib/gmail";
import { denyIfNotEmailUser, getSession } from "@/lib/session";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session.loggedIn) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const denied = await denyIfNotEmailUser();
  if (denied) return denied;

  const { id } = await params;
  const accountId = Number(id);
  if (!Number.isInteger(accountId)) {
    return Response.json({ error: "Invalid account id." }, { status: 400 });
  }

  let body: {
    dailyCap?: unknown;
    active?: unknown;
    appPassword?: unknown;
    senderName?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const updates: Partial<{
    dailyCap: number;
    active: boolean;
    appPassword: string;
    senderName: string | null;
  }> = {};
  if (body.senderName !== undefined) {
    const name =
      typeof body.senderName === "string" ? body.senderName.trim() : "";
    if (name.length > 60) {
      return Response.json(
        { error: "Keep the sender name to 60 characters or fewer." },
        { status: 400 },
      );
    }
    updates.senderName = name === "" ? null : name;
  }

  // Accounts connected through Google OAuth arrive with no app password, and
  // the create endpoint refuses an email it already knows — so this is the
  // only way such an account can ever gain the IMAP credential the reply
  // poller needs. Without it the account sends but never sees replies.
  if (body.appPassword !== undefined) {
    const appPassword =
      typeof body.appPassword === "string"
        ? normalizeAppPassword(body.appPassword)
        : "";
    if (appPassword.length !== 16) {
      return Response.json(
        {
          error:
            "Gmail app passwords are 16 characters (spaces are ignored). Check the value and try again.",
        },
        { status: 400 },
      );
    }
    const [account] = await db
      .select({ email: sendingAccount.email })
      .from(sendingAccount)
      .where(eq(sendingAccount.id, accountId));
    if (!account) {
      return Response.json({ error: "Account not found." }, { status: 404 });
    }
    // Verified with a real IMAP login before storing, same as at connect time
    // — a typo here would otherwise fail silently every poll.
    const verified = await verifyGmailAppPassword(account.email, appPassword);
    if (!verified.ok) {
      return Response.json({ error: verified.error }, { status: 422 });
    }
    updates.appPassword = encryptSecret(appPassword);
  }
  if (body.dailyCap !== undefined) {
    const dailyCap = Number(body.dailyCap);
    if (!Number.isInteger(dailyCap) || dailyCap < 0) {
      return Response.json(
        { error: "Daily cap must be a whole number of 0 or more." },
        { status: 400 },
      );
    }
    updates.dailyCap = dailyCap;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") {
      return Response.json({ error: "active must be a boolean." }, { status: 400 });
    }
    updates.active = body.active;
  }
  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "Nothing to update." }, { status: 400 });
  }

  const [updated] = await db
    .update(sendingAccount)
    .set(updates)
    .where(eq(sendingAccount.id, accountId))
    .returning({ id: sendingAccount.id });
  if (!updated) {
    return Response.json({ error: "Account not found." }, { status: 404 });
  }

  return Response.json({ ok: true });
}

/**
 * Remove a sending account entirely, along with its stored Google refresh
 * token and IMAP app password.
 *
 * Refused while anything still points at the account: `message.account_id`
 * is what every stat on the Accounts and Stats screens is counted from, and
 * `enrollment.assigned_account_id` is the pin that keeps a sequence's steps
 * 2+ in the same thread. Deleting through either would silently rewrite
 * history or strand a live sequence, so those cases get "deactivate instead".
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session.loggedIn) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const denied = await denyIfNotEmailUser();
  if (denied) return denied;

  const { id } = await params;
  const accountId = Number(id);
  if (!Number.isInteger(accountId)) {
    return Response.json({ error: "Invalid account id." }, { status: 400 });
  }

  const [account] = await db
    .select({
      id: sendingAccount.id,
      email: sendingAccount.email,
      domainId: sendingAccount.domainId,
    })
    .from(sendingAccount)
    .where(eq(sendingAccount.id, accountId));
  if (!account) {
    return Response.json({ error: "Account not found." }, { status: 404 });
  }

  const [{ count: messageCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(message)
    .where(eq(message.accountId, accountId));
  if (messageCount > 0) {
    return Response.json(
      {
        error: `${account.email} has ${messageCount} message${messageCount === 1 ? "" : "s"} in its history — deleting it would change past stats. Deactivate it instead to stop it being assigned sends.`,
      },
      { status: 409 },
    );
  }

  const [{ count: enrollmentCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(enrollment)
    .where(eq(enrollment.assignedAccountId, accountId));
  if (enrollmentCount > 0) {
    return Response.json(
      {
        error: `${account.email} is pinned to ${enrollmentCount} enrollment${enrollmentCount === 1 ? " that still needs" : "s that still need"} it to stay in-thread. Deactivate it instead.`,
      },
      { status: 409 },
    );
  }

  const domainRemoved = await db.transaction(async (tx) => {
    await tx.delete(sendingAccount).where(eq(sendingAccount.id, accountId));
    // A domain exists only to group accounts, so drop it once its last one
    // goes rather than leaving an empty card on the Accounts screen.
    const [{ count: siblings }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(sendingAccount)
      .where(eq(sendingAccount.domainId, account.domainId));
    if (siblings === 0) {
      await tx.delete(domain).where(eq(domain.id, account.domainId));
      return true;
    }
    return false;
  });

  return Response.json({ ok: true, email: account.email, domainRemoved });
}
