import { PageShell } from "@/components/page-shell";
import { RepliesList } from "@/components/replies/replies-list";
import { isDemoMode } from "@/lib/demo";
import { getReplies } from "@/lib/replies";

export const dynamic = "force-dynamic";

export default async function RepliesPage() {
  // The demo workspace has no inbound fixtures; an empty list reads honestly.
  const replies = (await isDemoMode()) ? [] : await getReplies();
  return (
    <PageShell title="Replies">
      <RepliesList replies={replies} />
    </PageShell>
  );
}
