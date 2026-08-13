import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { callLead } from "@/db/schema";
import { classifyPhone, phoneKey } from "@/lib/calls";
import { demoReadOnlyResponse, isDemoMode } from "@/lib/demo";
import { getSession } from "@/lib/session";
import { websiteHref } from "@/lib/website";

/** The lead's own fields — the ones a scrape can get wrong. Everything else on
 *  the spreadsheet is derived from calls and is corrected by fixing the call. */
const TEXT_FIELDS = ["company", "name", "title", "email"] as const;
type TextField = (typeof TEXT_FIELDS)[number];

const clean = (v: unknown) => {
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  // A cleared cell is empty, not the string "" — the rest of the app tests
  // these for null.
  return trimmed === "" ? null : trimmed.slice(0, 500);
};

/**
 * Correct a scraped lead in place.
 *
 * Only the fields the CSV brought in; a wrong number is the reason this
 * exists. The phone is re-keyed on the way through, because `phone_key` is
 * what duplicate detection runs on and a number edited without it would go on
 * being deduped against the old one.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session.loggedIn) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (await isDemoMode()) return demoReadOnlyResponse();

  const { id } = await params;
  const leadId = Number(id);
  if (!Number.isInteger(leadId)) {
    return Response.json({ error: "Invalid lead." }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const [lead] = await db
    .select({ id: callLead.id, callListId: callLead.callListId })
    .from(callLead)
    .where(eq(callLead.id, leadId));
  if (!lead) {
    return Response.json({ error: "Lead not found." }, { status: 404 });
  }

  const values: Partial<typeof callLead.$inferInsert> = {};

  for (const field of TEXT_FIELDS) {
    if (field in body) {
      const value = clean(body[field]);
      if (value === undefined) {
        return Response.json(
          { error: `${field} must be text.` },
          { status: 400 },
        );
      }
      values[field as TextField] = value;
    }
  }

  // Not one of TEXT_FIELDS: a website is stored normalised, so the cell and
  // the button can never disagree about where a click goes. Refusing what
  // cannot be parsed is the point — stored as typed, it would render a cell
  // with no button and no explanation.
  if ("website" in body) {
    const raw = typeof body.website === "string" ? body.website.trim() : "";
    if (raw === "") {
      values.website = null;
    } else {
      const href = websiteHref(raw);
      if (!href) {
        return Response.json(
          { error: "That does not look like a website address." },
          { status: 400 },
        );
      }
      values.website = href;
    }
  }

  if ("phone" in body) {
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const kind = classifyPhone(phone);
    if (kind === "missing") {
      return Response.json(
        { error: "A lead needs a phone number." },
        { status: 400 },
      );
    }
    // Same rule the importer applies: a number that cannot be rung in
    // Singapore is refused at the point of entry rather than sitting in the
    // queue waiting to waste a dial.
    if (kind !== "sg" && kind !== "sg_tollfree") {
      return Response.json(
        {
          error:
            kind === "foreign"
              ? "That is not a Singapore number."
              : "That number is the wrong length for Singapore.",
        },
        { status: 400 },
      );
    }

    const key = phoneKey(phone);
    // (call_list_id, phone_key) is unique, so a clash would otherwise come
    // back as a database error with nothing useful to show the caller.
    const [clash] = await db
      .select({ id: callLead.id, company: callLead.company })
      .from(callLead)
      .where(
        and(
          eq(callLead.callListId, lead.callListId),
          eq(callLead.phoneKey, key),
          ne(callLead.id, leadId),
        ),
      );
    if (clash) {
      return Response.json(
        {
          error: `${clash.company ?? "Another lead"} on this list already has that number.`,
        },
        { status: 409 },
      );
    }

    values.phone = phone;
    values.phoneKey = key;
  }

  if (Object.keys(values).length === 0) {
    return Response.json({ error: "Nothing to change." }, { status: 400 });
  }

  const [row] = await db
    .update(callLead)
    .set(values)
    .where(eq(callLead.id, leadId))
    .returning({
      id: callLead.id,
      phone: callLead.phone,
      company: callLead.company,
      name: callLead.name,
      title: callLead.title,
      email: callLead.email,
      website: callLead.website,
    });

  return Response.json(row);
}
