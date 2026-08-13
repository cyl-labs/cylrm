import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { campaign, contact, leadList, sendingAccount } from "@/db/schema";
import { PageShell } from "@/components/page-shell";
import { ImportDialog } from "@/components/leads/import-dialog";
import { LeadsTable } from "@/components/leads/leads-table";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {

  const [contacts, leadLists, accounts, campaigns] = await Promise.all([
    db
      .select({
        id: contact.id,
        email: contact.email,
        firstName: contact.firstName,
        lastName: contact.lastName,
        company: contact.company,
        title: contact.title,
        leadListId: contact.leadListId,
        leadListName: leadList.name,
        duplicateOfContactId: contact.duplicateOfContactId,
        importedAt: contact.importedAt,
      })
      .from(contact)
      .innerJoin(leadList, eq(contact.leadListId, leadList.id))
      .orderBy(desc(contact.importedAt), desc(contact.id)),
    db
      .select({ id: leadList.id, name: leadList.name })
      .from(leadList)
      .orderBy(desc(leadList.createdAt)),
    db
      .select({ id: sendingAccount.id, email: sendingAccount.email })
      .from(sendingAccount)
      .where(eq(sendingAccount.active, true))
      .orderBy(asc(sendingAccount.email)),
    db
      .select({ id: campaign.id, name: campaign.name })
      .from(campaign)
      .orderBy(desc(campaign.createdAt)),
  ]);

  const rows = contacts.map((c) => ({
    ...c,
    importedAt: c.importedAt.toISOString(),
  }));

  return (
    <PageShell
      title="Leads"
      actions={<ImportDialog leadLists={leadLists} campaigns={campaigns} />}
    >
      <LeadsTable
        contacts={rows}
        leadLists={leadLists}
        accounts={accounts}
        campaigns={campaigns}
      />
    </PageShell>
  );
}
