import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { appUser, callLead, callList } from "@/db/schema";
import { csvToRecords, type CsvRecord } from "@/lib/csv";
import { classifyPhone, e164, phoneKey } from "@/lib/calls";
import { getSession } from "@/lib/session";
import { websiteHref } from "@/lib/website";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const INSERT_CHUNK = 500;

/** How many ways one file may be split. Well above the size of the floor;
 *  it exists so a typo cannot ask for four hundred lists. */
const MAX_SPLIT = 10;

/** Lists named in the "already in the CRM" line on the review screen. Enough
 *  to recognise the niche you imported last month, not a full report. */
const OVERLAP_LISTS_SHOWN = 4;

/** The number kinds we hold a caller ID for. Anything else cannot be rung
 *  from this app, so it is refused at the door rather than sitting in a
 *  queue waiting to waste a dial. */
const DIALLABLE = new Set(["sg", "sg_tollfree", "us", "gb"]);

/**
 * Header matching, deliberately forgiving.
 *
 * Every scrape names its columns differently — `phone`, `mobile_number`,
 * `dm_phone`, `decision_maker_phone`, `generic_phone`, `best_phone` have all
 * turned up for the same thing. Headers are normalised (case, underscores and
 * hyphens folded to spaces) before matching, and each field keeps an ordered
 * list of candidate columns rather than one winner.
 */
const normalise = (h: string) =>
  h
    // camelCase is split before the case is folded, or the words run together
    // and match nothing: Apify's Google Places export heads every column that
    // way, so `phoneUnformatted` — the one column on it that carries E.164 —
    // was invisible and the file read as national format throughout.
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Order matters: it is the priority in which a row's columns are tried.
// A mobile or direct line reaches a person; a main line reaches reception.
const COLUMN_ALIASES = {
  phone: [
    // A column already in E.164 is the one unambiguous form there is, so it
    // wins outright: no country has to be inferred from it. Scrapes that
    // resolve the number properly emit both this and a display column, and
    // reading only the display one threw away the good value.
    "e164",
    "phone e164",
    "e164 phone",
    "international phone",
    "phone international",
    // Google Places' name for it: `phone` is "(765) 517-3870" and
    // `phoneUnformatted` is "+17655173870" on the same row.
    "phone unformatted",
    "unformatted phone",
    // A number checked against the company's own published contact details
    // beats anything the scrape guessed, so it wins next.
    "verified phone",
    "mobile number",
    "mobile phone",
    "mobile",
    "dm phone",
    "decision maker phone",
    "personal phone",
    "direct phone",
    "work direct phone",
    "contact phone",
    "phone",
    "phone number",
    "best phone",
    "telephone",
    "tel",
    "office line",
    "office number",
    "office phone",
    "landline",
    "nea phone",
    "company phone",
    "corporate phone",
    "general phone",
    "generic phone",
    "main line",
  ],
  name: [
    "decision maker name",
    "dm name",
    "verified contact",
    "contact name",
    "full name",
    "name",
    "first name",
  ],
  lastName: ["last name"],
  company: [
    "company name",
    "company",
    "firm name",
    "clinic name",
    "business name",
    "organisation",
    "organization",
    "org name",
  ],
  title: [
    "decision maker title",
    // Some scrapes call this "role" rather than "title"; without it the
    // job title is silently dropped on import.
    "decision maker role",
    "dm title",
    "dm role",
    "title",
    "job title",
    "role",
  ],
  email: [
    "personal direct email",
    "decision maker email",
    "dm email",
    "best email",
    "email",
    "email address",
    "general email",
    "generic email",
  ],
  // The company's own site. `source url` and `provenance url` are deliberately
  // absent: they say where the scraper found the lead, which is usually a
  // directory listing, and opening one tells a caller nothing about the
  // business they are about to ring.
  website: [
    "website",
    "website url",
    "company website",
    "web site",
    "homepage",
    "url",
    "site",
    "domain",
    "company domain",
  ],
} as const;

/** Every header matching any alias, in alias-priority order. */
function findColumns(headers: string[], aliases: readonly string[]) {
  const byNormalised = new Map<string, string>();
  for (const h of headers) {
    const key = normalise(h);
    if (!byNormalised.has(key)) byNormalised.set(key, h);
  }
  const found: string[] = [];
  for (const alias of aliases) {
    const match = byNormalised.get(alias);
    if (match !== undefined && !found.includes(match)) found.push(match);
  }
  return found;
}

/** First non-empty value across the candidate columns, for one row. */
/**
 * The best phone number on a row.
 *
 * A scrape often carries several: a display column, an E.164 column, a
 * site-scraped one. Alias order says which to prefer, but preference is not
 * the whole answer — the preferred column can hold something unusable while
 * another holds the same line written properly. So the first candidate that
 * actually classifies as diallable wins, and only if none do does the first
 * present value get returned, so the row is reported with the number a person
 * would recognise rather than a blank.
 */
function pickPhone(
  rec: CsvRecord,
  columns: string[],
  region: "sg" | "us" | "gb" | null,
): string | null {
  const candidates: string[] = [];
  for (const col of columns) {
    const v = rec[col]?.trim();
    if (v && v.toLowerCase() !== "na" && v !== "-") candidates.push(v);
  }
  for (const v of candidates) {
    if (DIALLABLE.has(classifyPhone(v, region))) return v;
  }
  return candidates[0] ?? null;
}

function pick(rec: CsvRecord, columns: string[]): string | null {
  for (const col of columns) {
    const v = rec[col]?.trim();
    if (v && v.toLowerCase() !== "na" && v !== "-") return v;
  }
  return null;
}

/** A Google Maps listing rather than a company's own site. */
function isListingUrl(value: string): boolean {
  const href = websiteHref(value);
  if (!href) return false;
  const { hostname, pathname } = new URL(href);
  return /(^|\.)google\.[a-z.]+$/.test(hostname) && pathname.startsWith("/maps");
}

/**
 * The company's own site, never the listing the scrape read it off.
 *
 * `url` is a website alias because most exports mean the company's site by it.
 * A Google Places scrape means the Maps listing, and its `website` column is
 * empty for precisely the businesses that have no site of their own — so
 * falling through to `url` put a Maps link on one lead in seven, which tells a
 * caller nothing and is the same reason `source url` was never an alias.
 * Narrowed to google.*\/maps so a business hosted on sites.google.com is left
 * alone.
 */
function pickWebsite(rec: CsvRecord, columns: string[]): string | null {
  for (const col of columns) {
    const v = rec[col]?.trim();
    if (!v || v.toLowerCase() === "na" || v === "-") continue;
    if (isListingUrl(v)) continue;
    return v;
  }
  return null;
}

/**
 * Stand-ins a scrape writes when it found no actual person.
 *
 * Storing "the team" as the contact name puts it on the dialler card as if
 * someone is called that, which is worse than showing no name at all.
 */
const PLACEHOLDER_NAMES = new Set([
  "the team",
  "team",
  "unknown",
  "n/a",
  "none",
  "-",
]);

function pickName(rec: CsvRecord, columns: string[]): string | null {
  const v = pick(rec, columns);
  return v && !PLACEHOLDER_NAMES.has(v.toLowerCase()) ? v : null;
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

  const form = await request.formData();
  const file = form.get("file");
  const name = form.get("name");
  const niche = form.get("niche");
  const regionRaw = form.get("region");
  const ownerRaw = form.get("assignedUserId");
  // Parse and report, write nothing. The bulk import runs this over every file
  // first so the review screen shows what each one actually holds - how many
  // usable numbers, what got skipped - before anybody commits to creating a
  // list. Counting rows in the browser would have to reimplement the phone
  // rules below and would drift from them the first time they changed.
  const dryRun = form.get("dryRun") === "1";
  const appendToRaw = form.get("callListId");
  const appendTo =
    typeof appendToRaw === "string" && appendToRaw !== ""
      ? Number(appendToRaw)
      : null;
  // Drop the rows whose number is already on some other lead rather than
  // storing them flagged. Both are "out of the queue"; this one also keeps
  // them out of the split, so each caller's share is the same size in leads
  // they can actually ring.
  const dropDuplicates = form.get("dropDuplicates") === "1";
  // One file into N lists, so one niche can be handed to several callers.
  const splitRaw = form.get("split");
  const split =
    typeof splitRaw === "string" && splitRaw !== "" ? Number(splitRaw) : 1;
  // One per part, in order; "" means nobody. Absent entirely means every part
  // takes `assignedUserId`, which is what a split of one has always done.
  const partOwnersRaw = form
    .getAll("partOwnerId")
    .filter((v): v is string => typeof v === "string");

  if (!(file instanceof File)) {
    return Response.json({ error: "No CSV file provided." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json({ error: "File exceeds 20 MB limit." }, { status: 400 });
  }
  if (appendTo !== null && !Number.isInteger(appendTo)) {
    return Response.json({ error: "Invalid call list." }, { status: 400 });
  }
  if (appendTo === null && !dryRun && (typeof name !== "string" || name.trim() === "")) {
    return Response.json({ error: "Call list name is required." }, { status: 400 });
  }
  if (!Number.isInteger(split) || split < 1 || split > MAX_SPLIT) {
    return Response.json(
      { error: `Split must be a whole number from 1 to ${MAX_SPLIT}.` },
      { status: 400 },
    );
  }
  // A split creates lists; there is nothing to create when adding to one that
  // already exists, and dealing a file across a list plus new ones would be a
  // merge nobody asked for.
  if (split > 1 && appendTo !== null) {
    return Response.json(
      { error: "A file added to an existing list cannot be split." },
      { status: 400 },
    );
  }
  if (partOwnersRaw.length > 0 && partOwnersRaw.length !== split) {
    return Response.json({ error: "Invalid owners for the split." }, { status: 400 });
  }

  // Both only mean anything on a new list: appending to one that exists must
  // not quietly re-file it or hand it to somebody else.
  let region: "sg" | "us" | "gb" | null = null;
  if (typeof regionRaw === "string" && regionRaw !== "") {
    if (regionRaw !== "sg" && regionRaw !== "us" && regionRaw !== "gb") {
      return Response.json({ error: "Invalid folder." }, { status: 400 });
    }
    region = regionRaw;
  }
  let badOwner = false;
  const parseOwner = (raw: string): number | null => {
    if (raw === "") return null;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed)) {
      badOwner = true;
      return null;
    }
    return parsed;
  };

  const assignedUserId = parseOwner(typeof ownerRaw === "string" ? ownerRaw : "");
  // One owner per part when the split names them, otherwise the file's own
  // owner for every part.
  const partOwners: (number | null)[] =
    partOwnersRaw.length > 0
      ? partOwnersRaw.map(parseOwner)
      : Array.from({ length: split }, () => assignedUserId);
  if (badOwner) {
    return Response.json({ error: "Invalid person." }, { status: 400 });
  }
  // Checked here rather than left to the foreign key, which would come back as
  // a constraint error with nothing to show the user. One query for the lot:
  // a ten-way split otherwise means ten round trips before anything is read.
  const ownerIds = [...new Set(partOwners.filter((o): o is number => o !== null))];
  if (ownerIds.length > 0) {
    const found = await db
      .select({ id: appUser.id })
      .from(appUser)
      .where(inArray(appUser.id, ownerIds));
    if (found.length !== ownerIds.length) {
      return Response.json({ error: "Person not found." }, { status: 404 });
    }
  }

  let existingList: {
    id: number;
    name: string;
    region: "sg" | "us" | "gb" | null;
  } | null = null;
  if (appendTo !== null) {
    const [found] = await db
      .select({ id: callList.id, name: callList.name, region: callList.region })
      .from(callList)
      .where(eq(callList.id, appendTo));
    if (!found) {
      return Response.json({ error: "Call list not found." }, { status: 404 });
    }
    existingList = found;
  }

  // National-format numbers are read in the list's market. Appending uses the
  // list's own, so a file added to a US niche is parsed the way the rest of
  // that niche was rather than the way this request happens to be labelled.
  const parseRegion = existingList ? existingList.region : region;

  const { headers, records } = csvToRecords(await file.text());
  if (records.length === 0) {
    return Response.json({ error: "CSV has no data rows." }, { status: 400 });
  }

  const phoneCols = findColumns(headers, COLUMN_ALIASES.phone);
  if (phoneCols.length === 0) {
    return Response.json(
      { error: `No phone column found. Columns present: ${headers.join(", ")}` },
      { status: 400 },
    );
  }
  const nameCols = findColumns(headers, COLUMN_ALIASES.name);
  const lastNameCols = findColumns(headers, COLUMN_ALIASES.lastName);
  const companyColsFound = findColumns(headers, COLUMN_ALIASES.company);
  const titleColsFound = findColumns(headers, COLUMN_ALIASES.title);

  // A directory scrape names the business in `title` and carries no company
  // column at all: "AK Auto Care LLC" is plainly not a job title. Read it as
  // the company when there is nothing better, and do not also store it as the
  // title, or every row ends up saying the same thing twice.
  //
  // Only when no company column matched. A contact list with both means
  // `title` really is the person's role and must stay there.
  const titleIsCompany =
    companyColsFound.length === 0 && titleColsFound.length > 0;
  const companyCols = titleIsCompany ? titleColsFound : companyColsFound;
  const titleCols = titleIsCompany ? [] : titleColsFound;
  const emailCols = findColumns(headers, COLUMN_ALIASES.email);
  const websiteCols = findColumns(headers, COLUMN_ALIASES.website);

  type ParsedRow = {
    phone: string;
    key: string;
    name: string | null;
    company: string | null;
    title: string | null;
    email: string | null;
    website: string | null;
    raw: CsvRecord;
  };

  const rows: ParsedRow[] = [];
  let skippedNoPhone = 0;
  let skippedRepeatedInFile = 0;
  const skippedBadNumber: { company: string; phone: string }[] = [];
  const seenInFile = new Set<string>();

  for (const rec of records) {
    const phone = pickPhone(rec, phoneCols, parseRegion) ?? "";
    const key = phoneKey(phone, parseRegion);
    const kind = classifyPhone(phone, parseRegion);

    if (kind === "missing") {
      skippedNoPhone++;
      continue;
    }
    // Scrapes pick up the odd overseas or malformed number — a German office
    // line on a Singapore workshop, a 13-digit string. They are reported by
    // name rather than silently dropped, so a real number entered wrongly can
    // be chased rather than quietly lost.
    //
    // US and UK are accepted alongside Singapore because those are the three
    // countries we hold a caller ID for; anywhere else still has no DID to
    // ring from, so importing it would only fill the queue with dead rows.
    if (!DIALLABLE.has(kind)) {
      skippedBadNumber.push({
        company: pick(rec, companyCols) ?? phone,
        phone,
      });
      continue;
    }
    // The same number twice in one list would just be rung twice.
    if (seenInFile.has(key)) {
      skippedRepeatedInFile++;
      continue;
    }
    seenInFile.add(key);

    const first = pickName(rec, nameCols) ?? "";
    const last = pickName(rec, lastNameCols) ?? "";
    const full = [first, last].filter(Boolean).join(" ");

    rows.push({
      // Rewritten to E.164 only when it would otherwise be unreadable outside
      // this function. Everything downstream — the dial button, the copy
      // button, DNC screening — re-reads this column with no idea which list
      // it came from, so a number that needed the market's context to parse
      // has to carry its country code from here on. One that already parses
      // on its own is left exactly as the scrape wrote it, which keeps
      // Singapore's numbers reading the way Singaporeans write them. The
      // original is in source_fields either way.
      phone: e164(phone) ? phone : (e164(phone, parseRegion) ?? phone),
      key,
      name: full || null,
      company: pick(rec, companyCols),
      title: pick(rec, titleCols),
      email: pick(rec, emailCols),
      // Normalised on the way in so the column holds openable URLs rather
      // than a mix of bare domains and junk. A value that will not parse is
      // dropped, not stored — source_fields still has the original.
      website: websiteHref(pickWebsite(rec, websiteCols)),
      raw: rec,
    });
  }

  // Every number in this file that the CRM has already seen, wherever it came
  // from. Run before the dry run returns as well as before an import, because
  // "how much of this file do I already have" is the question the review
  // screen exists to answer, and answering it afterwards is too late to act
  // on. Screening against the whole database rather than one chosen list is
  // deliberate: it is a superset of "the same niche", and ringing a business
  // twice is worth preventing whichever list the other copy sits on.
  const keys = [...new Set(rows.map((r) => r.key))];
  const canonicalByPhone = new Map<string, number>();
  const overlapCountByList = new Map<number, number>();
  for (const batch of chunk(keys, 5000)) {
    const existing = await db
      .select({
        id: callLead.id,
        callListId: callLead.callListId,
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
      overlapCountByList.set(
        row.callListId,
        (overlapCountByList.get(row.callListId) ?? 0) + 1,
      );
    }
  }
  const duplicatesInCrm = rows.filter((r) => canonicalByPhone.has(r.key)).length;

  // Reported before the empty check below, never as an error: a file whose
  // numbers are all national format has nothing usable *yet*, and telling the
  // review screen so is what lets it offer the folder that fixes it. Failing
  // here left the row with no controls and no way forward.
  if (dryRun) {
    // Named, not just counted. "87 already in the CRM" invites the question
    // "where?", and the answer is what tells you whether this is last month's
    // scrape of the same niche or an unrelated overlap.
    const top = [...overlapCountByList.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, OVERLAP_LISTS_SHOWN);
    const names =
      top.length > 0
        ? await db
            .select({ id: callList.id, name: callList.name })
            .from(callList)
            .where(
              inArray(
                callList.id,
                top.map(([id]) => id),
              ),
            )
        : [];
    const nameById = new Map(names.map((l) => [l.id, l.name]));
    return Response.json({
      dryRun: true,
      usable: rows.length,
      duplicatesInCrm,
      duplicateLists: top.map(([id, count]) => ({
        name: nameById.get(id) ?? "a deleted list",
        count,
      })),
      otherListCount: Math.max(0, overlapCountByList.size - top.length),
      skippedNoPhone,
      skippedBadNumber,
      skippedRepeatedInFile,
    });
  }

  if (rows.length === 0) {
    return Response.json(
      { error: "No row had a usable phone number." },
      { status: 400 },
    );
  }

  // A number already being worked elsewhere is either dropped outright or
  // stored flagged — flagged keeps the row visible while holding it out of
  // every queue, count and board, which is what this has always done.
  const keep = dropDuplicates
    ? rows.filter((r) => !canonicalByPhone.has(r.key))
    : rows;
  const removedDuplicates = rows.length - keep.length;

  if (keep.length === 0) {
    return Response.json(
      { error: "Every usable number in this file is already in the CRM." },
      { status: 400 },
    );
  }

  // Dealt round-robin rather than cut into blocks. A scrape arrives sorted —
  // by city, by rating, by whatever the directory ordered on — so contiguous
  // slices hand one caller every Alaska lead and another every Californian
  // one. Dealing gives each part the same mix and, to within one row, the
  // same size.
  const parts: ParsedRow[][] = Array.from({ length: split }, () => []);
  keep.forEach((r, i) => parts[i % split].push(r));

  const trimmedName = typeof name === "string" ? name.trim() : "";
  const nicheValue =
    typeof niche === "string" && niche.trim() !== "" ? niche.trim() : null;

  // All parts in one transaction: a split that half-succeeds leaves a niche
  // divided between callers with a chunk of it missing, which is worse than
  // having to import again.
  const result = await db.transaction(async (tx) => {
    const done = [];
    for (const [i, part] of parts.entries()) {
      const list =
        existingList ??
        (
          await tx
            .insert(callList)
            .values({
              // Derived rather than typed per part, so the review screen can
              // show exactly what will be created before it exists.
              name: split > 1 ? `${trimmedName} ${i + 1}` : trimmedName,
              niche: nicheValue,
              region,
              assignedUserId: partOwners[i],
            })
            .returning({ id: callList.id, name: callList.name })
        )[0];

      let inserted = 0;
      let duplicates = 0;
      for (const batch of chunk(part, INSERT_CHUNK)) {
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
            website: r.website,
            sourceFields: r.raw,
            duplicateOfLeadId: dup,
          };
        });
        // Appending a batch that overlaps what the list already holds hits the
        // (call_list_id, phone_key) index; skipping is the right answer, the
        // number is already in this queue.
        const rowsIn = await tx
          .insert(callLead)
          .values(values)
          .onConflictDoNothing()
          .returning({ id: callLead.id });
        inserted += rowsIn.length;
      }

      done.push({
        callListId: list.id,
        callListName: list.name,
        appended: existingList !== null,
        inserted,
        duplicates,
        // Only the first part carries the file-wide numbers, so a split does
        // not report the same 12 unusable rows once per list.
        removedDuplicates: i === 0 ? removedDuplicates : 0,
        alreadyInList: part.length - inserted,
        skippedNoPhone: i === 0 ? skippedNoPhone : 0,
        skippedBadNumber: i === 0 ? skippedBadNumber : [],
        skippedRepeatedInFile: i === 0 ? skippedRepeatedInFile : 0,
      });
    }
    return done;
  });

  // A split of one keeps the shape it has always had; anything more comes back
  // as the set of lists it made.
  return Response.json(split > 1 ? { split, parts: result } : result[0]);
}
