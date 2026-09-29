import { db } from "@/db";
import { recharge } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";

/** Log a top-up. Admin-only; `/api` sits outside the middleware. */
export async function POST(request: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin") {
    return Response.json({ error: "Admins only." }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as {
    amount?: unknown;
    currency?: unknown;
    paidOn?: unknown;
  } | null;
  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000) {
    return Response.json({ error: "Enter what you paid." }, { status: 400 });
  }
  const paidOn =
    typeof body?.paidOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.paidOn)
      ? body.paidOn
      : undefined;
  const [row] = await db
    .insert(recharge)
    .values({
      amountCents: Math.round(amount * 100),
      currency: body?.currency === "sgd" ? "sgd" : "usd",
      ...(paidOn ? { paidOn } : {}),
    })
    .returning();
  return Response.json({ recharge: row });
}
