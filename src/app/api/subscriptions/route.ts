import { db } from "@/db";
import { subscription } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";

/** Add a subscription. Admin-only; `/api` sits outside the middleware. */
export async function POST(request: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin") {
    return Response.json({ error: "Admins only." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    amount?: unknown;
    currency?: unknown;
    period?: unknown;
  } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const amount = Number(body?.amount);
  if (!name) return Response.json({ error: "Give it a name." }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
    return Response.json({ error: "Enter what it costs." }, { status: 400 });
  }

  const [row] = await db
    .insert(subscription)
    .values({
      name: name.slice(0, 80),
      amountCents: Math.round(amount * 100),
      currency: body?.currency === "usd" ? "usd" : "sgd",
      period: body?.period === "year" ? "year" : "month",
    })
    .returning();
  return Response.json({ subscription: row });
}
