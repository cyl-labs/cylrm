import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { domain, sendingAccount } from "@/db/schema";
import { encryptSecret } from "@/lib/crypto";
import { normalizeAppPassword, verifyGmailAppPassword } from "@/lib/gmail";
import { getSession } from "@/lib/session";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    email?: unknown;
    appPassword?: unknown;
    domainId?: unknown;
    domainName?: unknown;
    dailyCap?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) {
    return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  }

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

  const dailyCap = Number(body.dailyCap);
  if (!Number.isInteger(dailyCap) || dailyCap < 0) {
    return Response.json(
      { error: "Daily cap must be a whole number of 0 or more." },
      { status: 400 },
    );
  }

  const domainId = body.domainId == null ? null : Number(body.domainId);
  const domainName =
    typeof body.domainName === "string" ? body.domainName.trim() : "";
  if (domainId === null && domainName === "") {
    return Response.json(
      { error: "Pick a domain or enter a new domain name." },
      { status: 400 },
    );
  }

  const [existing] = await db
    .select({ id: sendingAccount.id })
    .from(sendingAccount)
    .where(eq(sql`lower(${sendingAccount.email})`, email));
  if (existing) {
    return Response.json(
      { error: `${email} is already connected.` },
      { status: 409 },
    );
  }

  const verified = await verifyGmailAppPassword(email, appPassword);
  if (!verified.ok) {
    return Response.json({ error: verified.error }, { status: 422 });
  }

  let resolvedDomainId: number;
  if (domainId !== null) {
    const [found] = await db
      .select({ id: domain.id })
      .from(domain)
      .where(eq(domain.id, domainId));
    if (!found) {
      return Response.json({ error: "Domain not found." }, { status: 400 });
    }
    resolvedDomainId = found.id;
  } else {
    const [found] = await db
      .select({ id: domain.id })
      .from(domain)
      .where(eq(sql`lower(${domain.name})`, domainName.toLowerCase()));
    resolvedDomainId =
      found?.id ??
      (
        await db
          .insert(domain)
          .values({ name: domainName })
          .returning({ id: domain.id })
      )[0].id;
  }

  const [account] = await db
    .insert(sendingAccount)
    .values({
      email,
      domainId: resolvedDomainId,
      appPassword: encryptSecret(appPassword),
      dailyCap,
      active: true,
    })
    .returning({ id: sendingAccount.id, email: sendingAccount.email });

  return Response.json({ account });
}
