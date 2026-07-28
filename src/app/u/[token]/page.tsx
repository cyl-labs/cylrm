import { db } from "@/db";
import { contact } from "@/db/schema";
import { eq } from "drizzle-orm";
import { unsubscribeByContactId } from "@/lib/unsubscribe";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe-token";

export const dynamic = "force-dynamic";

/**
 * Public unsubscribe confirmation. No login — the signed token is the
 * authority. It confirms rather than acting on load, because mail clients and
 * link scanners fetch URLs to build previews and would otherwise unsubscribe
 * people who never clicked.
 */
export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const { token } = await params;
  const { done } = await searchParams;
  const contactId = verifyUnsubscribeToken(token);

  if (contactId === null) {
    return (
      <Shell title="Link not recognised">
        <p>
          This unsubscribe link is not valid. It may have been altered in
          transit. Replying to the email will also get you removed.
        </p>
      </Shell>
    );
  }

  const [row] = await db
    .select({ email: contact.email })
    .from(contact)
    .where(eq(contact.id, contactId));

  if (done === "1") {
    return (
      <Shell title="You've been unsubscribed">
        <p>
          {row?.email ? <strong>{row.email}</strong> : "That address"} will not
          receive any further emails from us. Nothing else is needed.
        </p>
      </Shell>
    );
  }

  async function confirm() {
    "use server";
    await unsubscribeByContactId(contactId!);
    const { redirect } = await import("next/navigation");
    redirect(`/u/${token}?done=1`);
  }

  return (
    <Shell title="Unsubscribe">
      <p>
        Stop sending emails to{" "}
        {row?.email ? <strong>{row.email}</strong> : "this address"}?
      </p>
      <form action={confirm}>
        <button
          type="submit"
          className="mt-5 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
        >
          Yes, unsubscribe me
        </button>
      </form>
    </Shell>
  );
}

function Shell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <h1 className="text-lg font-semibold tracking-[-0.01em]">{title}</h1>
      <div className="mt-2 text-[15px] leading-relaxed text-neutral-600">
        {children}
      </div>
    </main>
  );
}
