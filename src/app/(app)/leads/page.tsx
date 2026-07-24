import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { contact, leadList } from "@/db/schema";
import { PageShell } from "@/components/page-shell";
import { ImportDialog } from "@/components/leads/import-dialog";
import { LeadsTable } from "@/components/leads/leads-table";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const [contacts, leadLists] = await Promise.all([
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
        neverbounceResult: contact.neverbounceResult,
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
  ]);

  const rows = contacts.map((c) => ({
    ...c,
    importedAt: c.importedAt.toISOString(),
  }));

  return (
    <PageShell title="Leads" actions={<ImportDialog />}>
      <LeadsTable contacts={rows} leadLists={leadLists} />
    </PageShell>
  );
}
