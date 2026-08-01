import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { callLead, callList } from "@/db/schema";
import { csvToRecords, type CsvRecord } from "@/lib/csv";
import { phoneKey } from "@/lib/calls";
import { demoReadOnlyResponse, isDemoMode } from "@/lib/demo";
import { getSession } from "@/lib/session";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const INSERT_CHUNK = 500;

// A calling list is keyed on the phone number, so that column is the only one
// that has to be present. "Company Phone" and "Corporate Phone" come first
// because that is what an Apollo export labels the switchboard number.
const COLUMN_ALIASES = {
  phone: [
    "company phone",
    "corporate phone",
    "phone",
    "phone number",
    "mobile",
    "mobile phone",
    "work direct phone",
    "contact phone",
    "telephone",
  ],
  name: ["name", "first name", "contact name", "full name"],
  lastName: ["last name"],
  company: ["company", "company name", "organisation", "organization"],
  title: ["title", "job title"],
  email: ["email", "email address"],
} as const;

function findColumn(headers: string[], aliases: readonly string[]) {
  for (const alias of aliases) {
    const match = headers.find((h) => h.toLowerCase().trim() === alias);
    if (match !== undefined) return match;
  }
  return undefined;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (await isDemoMode()) return demoReadOnlyResponse();

  const form = await request.formData();
  const file = form.get("file");
  const name = form.get("name");
  const niche = form.get("niche");
  const appendToRaw = form.get("callListId");
  const appendTo =
    typeof appendToRaw === "string" && appendToRaw !== ""
      ? Number(appendToRaw)
      : null;

  if (!(file instanceof File)) {
    return Response.json({ error: "No CSV file provided." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json({ error: "File exceeds 20 MB limit." }, { status: 400 });
  }
  if (appendTo !== null && !Number.isInteger(appendTo)) {
    return Response.json({ error: "Invalid call list." }, { status: 400 });
  }
  if (appendTo === null && (typeof name !== "string" || name.trim() === "")) {
    return Response.json({ error: "Call list name is required." }, { status: 400 });
  }

  let existingList: { id: number; name: string } | null = null;
  if (appendTo !== null) {
    const [found] = await db
      .select({ id: callList.id, name: callList.name })
      .from(callList)
      .where(eq(callList.id, appendTo));
    if (!found) {
      return Response.json({ error: "Call list not found." }, { status: 404 });
    }
    existingList = found;
  }

  const { headers, records } = csvToRecords(await file.text());
  if (records.length === 0) {
    return Response.json({ error: "CSV has no data rows." }, { status: 400 });
  }

  const phoneCol = findColumn(headers, COLUMN_ALIASES.phone);
  if (!phoneCol) {
    return Response.json(
      { error: `No phone column found. Columns present: ${headers.join(", ")}` },
      { status: 400 },
    );
  }
  const nameCol = findColumn(headers, COLUMN_ALIASES.name);
  const lastNameCol = findColumn(headers, COLUMN_ALIASES.lastName);
  const companyCol = findColumn(headers, COLUMN_ALIASES.company);
  const titleCol = findColumn(headers, COLUMN_ALIASES.title);
  const emailCol = findColumn(headers, COLUMN_ALIASES.email);

  type ParsedRow = {
    phone: string;
    key: string;
    name: string | null;
    company: string | null;
    title: string | null;
    email: string | null;
    raw: CsvRecord;
  };

  const rows: ParsedRow[] = [];
  let skippedNoPhone = 0;
  let skippedRepeatedInFile = 0;
  const seenInFile = new Set<string>();

  for (const rec of records) {
    const phone = (rec[phoneCol] ?? "").trim();
    const key = phoneKey(phone);
    // Fewer than 7 digits cannot be a dialable number — usually a stray
    // extension column or a placeholder like "-".
    if (key.length < 7) {
      skippedNoPhone++;
      continue;
    }
    // The same number twice in one list would just be rung twice.
    if (seenInFile.has(key)) {
      skippedRepeatedInFile++;
      continue;
    }
    seenInFile.add(key);

    const first = (nameCol && rec[nameCol]?.trim()) || "";
    const last = (lastNameCol && rec[lastNameCol]?.trim()) || "";
    const full = [first, last].filter(Boolean).join(" ");

    rows.push({
      phone,
      key,
      name: full || null,
      company: (companyCol && rec[companyCol]?.trim()) || null,
      title: (titleCol && rec[titleCol]?.trim()) || null,
      email: (emailCol && rec[emailCol]?.trim()) || null,
      raw: rec,
    });
  }

  if (rows.length === 0) {
    return Response.json(
      { error: "No row had a usable phone number." },
      { status: 400 },
    );
  }

  // A number already being worked on another list is flagged rather than
  // dropped, so the row is visible but stays out of the queue — calling the
  // same business twice from two lists is the thing worth preventing.
  const keys = [...new Set(rows.map((r) => r.key))];
  const canonicalByPhone = new Map<string, number>();
  for (const batch of chunk(keys, 5000)) {
    const existing = await db
      .select({
        id: callLead.id,
        phoneKey: callLead.phoneKey,
        duplicateOfLeadId: callLead.duplicateOfLeadId,
      })
      .from(callLead)
      .where(inArray(callLead.phoneKey, batch));
    for (const row of existing) {
      const canonical = row.duplicateOfLeadId ?? row.id;
      const current = canonicalByPhone.get(row.phoneKey);
      if (current === undefined || canonical < current) {
        canonicalByPhone.set(row.phoneKey, canonical);
      }
    }
  }

  const result = await db.transaction(async (tx) => {
    const list =
      existingList ??
      (
        await tx
          .insert(callList)
          .values({
            name: (name as string).trim(),
            niche:
              typeof niche === "string" && niche.trim() !== ""
                ? niche.trim()
                : null,
          })
          .returning({ id: callList.id, name: callList.name })
      )[0];

    let inserted = 0;
    let duplicates = 0;
    for (const batch of chunk(rows, INSERT_CHUNK)) {
      const values = batch.map((r) => {
        const dup = canonicalByPhone.get(r.key);
        if (dup !== undefined) duplicates++;
        return {
          callListId: list.id,
          phone: r.phone,
          phoneKey: r.key,
          name: r.name,
          company: r.company,
          title: r.title,
          email: r.email,
          sourceFields: r.raw,
          duplicateOfLeadId: dup,
        };
      });
      // Appending a batch that overlaps what the list already holds hits the
      // (call_list_id, phone_key) index; skipping is the right answer, the
      // number is already in this queue.
      const done = await tx
        .insert(callLead)
        .values(values)
        .onConflictDoNothing()
        .returning({ id: callLead.id });
      inserted += done.length;
    }

    return {
      callListId: list.id,
      callListName: list.name,
      appended: existingList !== null,
      inserted,
      duplicates,
      alreadyInList: rows.length - inserted,
      skippedNoPhone,
      skippedRepeatedInFile,
    };
  });

  return Response.json(result);
}
