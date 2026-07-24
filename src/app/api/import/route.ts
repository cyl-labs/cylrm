import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { contact, leadList } from "@/db/schema";
import { csvToRecords, type CsvRecord } from "@/lib/csv";
import { demoReadOnlyResponse, isDemoMode } from "@/lib/demo";
import { getSession } from "@/lib/session";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const INSERT_CHUNK = 500;

const COLUMN_ALIASES = {
  email: ["email", "email address"],
  firstName: ["first name"],
  lastName: ["last name"],
  company: ["company", "company name", "company name for emails"],
  title: ["title", "job title"],
} as const;

type NeverbounceResult = "valid" | "invalid" | "accept_all" | "unknown";

function findColumn(headers: string[], aliases: readonly string[]) {
  for (const alias of aliases) {
    const match = headers.find((h) => h.toLowerCase() === alias);
    if (match !== undefined) return match;
  }
  return undefined;
}

function findNeverbounceColumn(headers: string[]) {
  return headers.find((h) => h.toLowerCase().includes("neverbounce"));
}

function mapNeverbounce(raw: string | undefined): NeverbounceResult {
  const value = (raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (value === "valid") return "valid";
  if (value === "invalid") return "invalid";
  if (value === "catchall" || value === "catch_all" || value === "accept_all")
    return "accept_all";
  return "unknown";
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

  if (!(file instanceof File)) {
    return Response.json({ error: "No CSV file provided." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json({ error: "File exceeds 20 MB limit." }, { status: 400 });
  }
  if (typeof name !== "string" || name.trim() === "") {
    return Response.json({ error: "Lead list name is required." }, { status: 400 });
  }

  const { headers, records } = csvToRecords(await file.text());
  if (records.length === 0) {
    return Response.json({ error: "CSV has no data rows." }, { status: 400 });
  }

  const emailCol = findColumn(headers, COLUMN_ALIASES.email);
  if (!emailCol) {
    return Response.json(
      {
        error: `No "Email" column found. Columns present: ${headers.join(", ")}`,
      },
      { status: 400 },
    );
  }
  const firstNameCol = findColumn(headers, COLUMN_ALIASES.firstName);
  const lastNameCol = findColumn(headers, COLUMN_ALIASES.lastName);
  const companyCol = findColumn(headers, COLUMN_ALIASES.company);
  const titleCol = findColumn(headers, COLUMN_ALIASES.title);
  const neverbounceCol = findNeverbounceColumn(headers);

  type ParsedRow = {
    email: string;
    emailKey: string;
    firstName: string | null;
    lastName: string | null;
    company: string | null;
    title: string | null;
    neverbounceResult: NeverbounceResult;
    raw: CsvRecord;
  };

  const rows: ParsedRow[] = [];
  let skippedNoEmail = 0;
  for (const rec of records) {
    const email = (emailCol ? rec[emailCol] : "").trim();
    if (email === "") {
      skippedNoEmail++;
      continue;
    }
    rows.push({
      email,
      emailKey: email.toLowerCase(),
      firstName: (firstNameCol && rec[firstNameCol]) || null,
      lastName: (lastNameCol && rec[lastNameCol]) || null,
      company: (companyCol && rec[companyCol]) || null,
      title: (titleCol && rec[titleCol]) || null,
      neverbounceResult: mapNeverbounce(neverbounceCol ? rec[neverbounceCol] : undefined),
      raw: rec,
    });
  }

  if (rows.length === 0) {
    return Response.json(
      { error: "Every row is missing an email address." },
      { status: 400 },
    );
  }

  // Duplicate detection: match each incoming email (case-insensitive) against
  // every existing contact across all lead lists. The canonical contact for an
  // email is the earliest row that is not itself a duplicate.
  const emailKeys = [...new Set(rows.map((r) => r.emailKey))];
  const canonicalByEmail = new Map<string, number>();
  for (const keys of chunk(emailKeys, 5000)) {
    const existing = await db
      .select({
        id: contact.id,
        email: contact.email,
        duplicateOfContactId: contact.duplicateOfContactId,
      })
      .from(contact)
      .where(inArray(sql`lower(${contact.email})`, keys));
    for (const row of existing) {
      const key = row.email.toLowerCase();
      const canonicalId = row.duplicateOfContactId ?? row.id;
      const current = canonicalByEmail.get(key);
      if (current === undefined || canonicalId < current) {
        canonicalByEmail.set(key, canonicalId);
      }
    }
  }

  const result = await db.transaction(async (tx) => {
    const [list] = await tx
      .insert(leadList)
      .values({
        name: name.trim(),
        niche: typeof niche === "string" && niche.trim() !== "" ? niche.trim() : null,
      })
      .returning({ id: leadList.id });

    // Pass 1: first occurrence of each email not already in the system —
    // inserted as canonical contacts.
    const canonicalRows: ParsedRow[] = [];
    const duplicateRows: ParsedRow[] = [];
    const seenInFile = new Set<string>();
    for (const row of rows) {
      if (canonicalByEmail.has(row.emailKey) || seenInFile.has(row.emailKey)) {
        duplicateRows.push(row);
      } else {
        seenInFile.add(row.emailKey);
        canonicalRows.push(row);
      }
    }

    for (const batch of chunk(canonicalRows, INSERT_CHUNK)) {
      const inserted = await tx
        .insert(contact)
        .values(
          batch.map((r) => ({
            email: r.email,
            firstName: r.firstName,
            lastName: r.lastName,
            company: r.company,
            title: r.title,
            leadListId: list.id,
            apolloFields: r.raw,
            neverbounceResult: r.neverbounceResult,
          })),
        )
        .returning({ id: contact.id, email: contact.email });
      for (const row of inserted) {
        canonicalByEmail.set(row.email.toLowerCase(), row.id);
      }
    }

    // Pass 2: duplicates point at the canonical contact for their email.
    for (const batch of chunk(duplicateRows, INSERT_CHUNK)) {
      await tx.insert(contact).values(
        batch.map((r) => ({
          email: r.email,
          firstName: r.firstName,
          lastName: r.lastName,
          company: r.company,
          title: r.title,
          leadListId: list.id,
          apolloFields: r.raw,
          neverbounceResult: r.neverbounceResult,
          duplicateOfContactId: canonicalByEmail.get(r.emailKey),
        })),
      );
    }

    return {
      leadListId: list.id,
      imported: rows.length,
      duplicates: duplicateRows.length,
      skippedNoEmail,
      neverbounceColumn: neverbounceCol ?? null,
    };
  });

  return Response.json(result);
}
