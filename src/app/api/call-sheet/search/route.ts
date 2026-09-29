import { getSheetLeads, SHEET_SEARCH_LIMIT } from "@/lib/calls";
import { callScope, getCurrentUser } from "@/lib/session";

/**
 * Spreadsheet search across every list the reader may see.
 *
 * The sheet loads one list at a time, so typing a business name in its search
 * box asks here rather than filtering what the browser holds. Scoped by
 * `callScope` exactly as the sheet itself is: a caller finds leads on their
 * own niches and nothing else.
 */
export async function GET(request: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  if (q.length < 2) return Response.json({ leads: [], capped: false, limit: SHEET_SEARCH_LIMIT });

  // One more than the limit, so "there are more" is known without a count.
  const rows = await getSheetLeads(callScope(me), {
    search: q,
    limit: SHEET_SEARCH_LIMIT + 1,
  });
  return Response.json(
    {
      leads: rows.slice(0, SHEET_SEARCH_LIMIT),
      capped: rows.length > SHEET_SEARCH_LIMIT,
      limit: SHEET_SEARCH_LIMIT,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
