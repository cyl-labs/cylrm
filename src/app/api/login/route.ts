import { getSession } from "@/lib/session";

export async function POST(request: Request) {
  const form = await request.formData();
  const password = form.get("password");

  if (typeof password !== "string" || password !== process.env.APP_PASSWORD) {
    return new Response(null, { status: 303, headers: { Location: "/login?error=1" } });
  }

  const session = await getSession();
  session.loggedIn = true;
  await session.save();
  return new Response(null, { status: 303, headers: { Location: "/" } });
}
