import { PageShell } from "@/components/page-shell";
import { RepliesList } from "@/components/replies/replies-list";
import { getReplies } from "@/lib/replies";

export const dynamic = "force-dynamic";

export default async function RepliesPage() {
  const replies = await getReplies();
  return (
    <PageShell title="Replies">
      <RepliesList replies={replies} />
    </PageShell>
  );
}
