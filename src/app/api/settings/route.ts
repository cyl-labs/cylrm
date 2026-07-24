import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSetting } from "@/db/schema";
import { getSession } from "@/lib/session";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function PUT(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    sendingWindowStart?: unknown;
    sendingWindowEnd?: unknown;
    sendingTimezone?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const start =
    typeof body.sendingWindowStart === "string" ? body.sendingWindowStart : "";
  const end =
    typeof body.sendingWindowEnd === "string" ? body.sendingWindowEnd : "";
  const timezone =
    typeof body.sendingTimezone === "string" ? body.sendingTimezone : "";

  if (!TIME_RE.test(start) || !TIME_RE.test(end)) {
    return Response.json(
      { error: "Start and end must be times in HH:MM format." },
      { status: 400 },
    );
  }
  if (start >= end) {
    return Response.json(
      { error: "The window start must be before its end." },
      { status: 400 },
    );
  }
  if (!isValidTimezone(timezone)) {
    return Response.json(
      { error: `"${timezone}" is not a valid IANA timezone.` },
      { status: 400 },
    );
  }

  const values = {
    sendingWindowStart: start,
    sendingWindowEnd: end,
    sendingTimezone: timezone,
  };

  const [existing] = await db
    .select({ id: appSetting.id })
    .from(appSetting)
    .limit(1);
  if (existing) {
    await db.update(appSetting).set(values).where(eq(appSetting.id, existing.id));
  } else {
    await db.insert(appSetting).values(values);
  }

  return Response.json({ ok: true });
}
