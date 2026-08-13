import { asc, eq, sql } from "drizzle-orm";
import { Plug } from "lucide-react";
import { db } from "@/db";
import { appSetting, domain, message, sendingAccount } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/page-shell";
import { AccountsView } from "@/components/accounts/accounts-view";
import { ConnectAccountDialog } from "@/components/accounts/connect-account-dialog";
import { SendingWindowCard } from "@/components/accounts/sending-window-card";

export const dynamic = "force-dynamic";

async function getOrCreateSetting() {
  const [existing] = await db.select().from(appSetting).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(appSetting).values({}).returning();
  return created;
}

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ google_connected?: string; google_error?: string }>;
}) {
  const { google_connected: googleConnected, google_error: googleError } =
    await searchParams;

  const setting = await getOrCreateSetting();
  const tz = setting.sendingTimezone;

  const [accounts, domains, stats] = await Promise.all([
    db
      .select({
        id: sendingAccount.id,
        email: sendingAccount.email,
        senderName: sendingAccount.senderName,
        active: sendingAccount.active,
        dailyCap: sendingAccount.dailyCap,
        domainId: sendingAccount.domainId,
        domainName: domain.name,
        hasGoogle: sql<boolean>`${sendingAccount.googleRefreshToken} is not null`,
        needsReconnect: sendingAccount.needsReconnect,
        googleConnectedAt: sendingAccount.googleConnectedAt,
        hasAppPassword: sql<boolean>`${sendingAccount.appPassword} is not null`,
      })
      .from(sendingAccount)
      .innerJoin(domain, eq(sendingAccount.domainId, domain.id))
      .orderBy(asc(domain.name), asc(sendingAccount.email)),
    db
      .select({ id: domain.id, name: domain.name })
      .from(domain)
      .orderBy(asc(domain.name)),
    db
      .select({
        accountId: message.accountId,
        sentToday: sql<number>`count(*) filter (where ${message.kind} = 'sent' and (${message.sentAt} at time zone ${tz})::date = (now() at time zone ${tz})::date)::int`,
        sentTotal: sql<number>`count(*) filter (where ${message.kind} = 'sent')::int`,
        bounceTotal: sql<number>`count(*) filter (where ${message.kind} = 'bounce')::int`,
      })
      .from(message)
      .groupBy(message.accountId),
  ]);

  const statsByAccount = new Map(stats.map((s) => [s.accountId, s]));
  const rows = accounts.map((a) => {
    const s = statsByAccount.get(a.id);
    return {
      ...a,
      googleConnectedAt: a.googleConnectedAt?.toISOString() ?? null,
      sentToday: s?.sentToday ?? 0,
      sentTotal: s?.sentTotal ?? 0,
      bounceTotal: s?.bounceTotal ?? 0,
    };
  });

  return (
    <PageShell
      title="Accounts"
      actions={
        <>
          <Button asChild size="sm" variant="outline">
            {/* Route handler flow — plain link, no client JS needed. */}
            <a href="/api/google/connect">
              <Plug data-icon="inline-start" />
              Connect via Google
            </a>
          </Button>
          <ConnectAccountDialog domains={domains} />
        </>
      }
    >
      {(googleConnected || googleError) && (
        <div
          className={`mx-6 mt-4 rounded-lg border px-4 py-2.5 text-[13px] ${
            googleError
              ? "border-destructive/30 bg-destructive/5 text-destructive"
              : "border-success/30 bg-success/5 text-success"
          }`}
        >
          {googleError
            ? googleError === "missing_send_permission"
              ? 'Google connected without the "Send email on your behalf" permission — reconnect and tick that checkbox on Google\'s consent screen.'
              : `Google connect failed: ${googleError}`
            : `Google connected for ${googleConnected}.`}
        </div>
      )}
      <div className="grid grid-cols-1 items-start gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <AccountsView accounts={rows} />
        <SendingWindowCard
          initial={{
            sendingWindowStart: setting.sendingWindowStart.slice(0, 5),
            sendingWindowEnd: setting.sendingWindowEnd.slice(0, 5),
            sendingTimezone: setting.sendingTimezone,
            sendWeekdaysOnly: setting.sendWeekdaysOnly,
          }}
        />
      </div>
    </PageShell>
  );
}
