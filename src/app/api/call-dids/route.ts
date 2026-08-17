import { getCurrentUser } from "@/lib/session";

/**
 * The numbers on the Telnyx account, for the Team screen to offer.
 *
 * Admin-only: which numbers the business owns is set-up, not day-to-day work.
 * A list to pick from rather than a box to type a phone number into, because a
 * mistyped digit becomes the caller ID every prospect sees.
 */

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

  // Best effort. If Telnyx is unreachable the screen still shows what is set;
  // it just cannot offer the list to pick from.
  let numbers: {
    phoneNumber: string;
    country: string | null;
    inbound: string | null;
  }[] = [];
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
          data?: {
            phone_number: string;
            country_iso_alpha2?: string;
            connection_name?: string | null;
          }[];
        };
        // What the number is wired to for *inbound*. Assigning it as a caller
        // ID here changes none of that, but a prospect who rings back reaches
        // whatever is on the other end, so the screen has to say what that is.
        numbers = (body.data ?? []).map((n) => ({
          phoneNumber: n.phone_number,
          country: n.country_iso_alpha2 ?? null,
          inbound: n.connection_name ?? null,
        }));
      }
    } catch {
      // Leave the list empty; the mapping below is still editable.
    }
  }

  return Response.json({ numbers });
}
