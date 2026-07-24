import { getSession } from "@/lib/session";

export async function POST(request: Request) {
  const session = await getSession();
  session.destroy();
  return new Response(null, { status: 303, headers: { Location: "/login" } });
}
