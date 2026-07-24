import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appSetting, domain, message, sendingAccount } from "@/db/schema";
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

export default async function AccountsPage() {
  const setting = await getOrCreateSetting();
  const tz = setting.sendingTimezone;

  const [accounts, domains, stats] = await Promise.all([
    db
      .select({
        id: sendingAccount.id,
        email: sendingAccount.email,
        active: sendingAccount.active,
        dailyCap: sendingAccount.dailyCap,
        domainId: sendingAccount.domainId,
        domainName: domain.name,
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
      sentToday: s?.sentToday ?? 0,
      sentTotal: s?.sentTotal ?? 0,
      bounceTotal: s?.bounceTotal ?? 0,
    };
  });

  return (
    <PageShell
      title="Accounts"
      actions={<ConnectAccountDialog domains={domains} />}
    >
      <div className="grid grid-cols-1 items-start gap-4 px-6 py-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <AccountsView accounts={rows} />
        <SendingWindowCard
          initial={{
            sendingWindowStart: setting.sendingWindowStart.slice(0, 5),
            sendingWindowEnd: setting.sendingWindowEnd.slice(0, 5),
            sendingTimezone: setting.sendingTimezone,
          }}
        />
      </div>
    </PageShell>
  );
}
