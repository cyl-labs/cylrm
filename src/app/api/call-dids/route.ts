import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/session";

/**
 * Caller ID per market.
 *
 * Admin-only, both reading and writing. Which numbers the business owns and
 * which one a market dials from is set-up, not day-to-day work, and a caller
 * changing it would silently change what every prospect sees.
 *
 * GET returns the numbers on the Telnyx account alongside the current mapping,
 * so the screen offers a list to choose from rather than a box to type a phone
 * number into and get wrong.
 */
const REGIONS = ["sg", "us", "gb"] as const;

async function requireAdmin() {
  const me = await getCurrentUser();
  if (!me) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  if (me.role !== "admin") {
    return {
      error: Response.json(
        { error: "Only an admin can change the calling numbers." },
        { status: 403 },
      ),
    };
  }
  return { me };
}

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const rows = (await db.execute(sql`
    select region, phone_number from call_did
  `)) as { region: string; phone_number: string }[];

  // Best effort. If Telnyx is unreachable the screen still shows what is set;
  // it just cannot offer the list to pick from.
  let numbers: { phoneNumber: string; country: string | null }[] = [];
  const apiKey = process.env.TELNYX_API_KEY;
  if (apiKey) {
    try {
      const res = await fetch(
        "https://api.telnyx.com/v2/phone_numbers?page%5Bsize%5D=50",
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (res.ok) {
        const body = (await res.json()) as {
          data?: { phone_number: string; country_iso_alpha2?: string }[];
        };
        numbers = (body.data ?? []).map((n) => ({
          phoneNumber: n.phone_number,
          country: n.country_iso_alpha2 ?? null,
        }));
      }
    } catch {
      // Leave the list empty; the mapping below is still editable.
    }
  }

  return Response.json({
    dids: Object.fromEntries(rows.map((r) => [r.region, r.phone_number])),
    numbers,
  });
}

export async function PATCH(request: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  const body = (await request.json().catch(() => null)) as {
    region?: unknown;
    phoneNumber?: unknown;
  } | null;
  if (!body) {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!REGIONS.includes(body.region as (typeof REGIONS)[number])) {
    return Response.json({ error: "Unknown market." }, { status: 400 });
  }

  const region = body.region as string;
  const number =
    typeof body.phoneNumber === "string" ? body.phoneNumber.trim() : "";

  // Empty clears it, which is how a market goes back to having no caller ID
  // and its dial button back to saying so.
  if (number === "") {
    await db.execute(sql`delete from call_did where region = ${region}`);
    return Response.json({ region, phoneNumber: null });
  }
  if (!/^\+[1-9]\d{6,15}$/.test(number)) {
    return Response.json(
      { error: "A caller ID has to be in E.164, like +6531258472." },
      { status: 400 },
    );
  }

  await db.execute(sql`
    insert into call_did (region, phone_number, updated_at)
    values (${region}, ${number}, now())
    on conflict (region) do update
      set phone_number = excluded.phone_number, updated_at = now()
  `);
  return Response.json({ region, phoneNumber: number });
}
