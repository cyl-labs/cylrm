import { cookies } from "next/headers";

export const DEMO_COOKIE = "cylrm_demo";

/** Demo mode renders every screen from static fixtures (lib/demo-data.ts)
 * instead of the database. Toggled via /api/demo from the logo switcher. */
export async function isDemoMode(): Promise<boolean> {
  return (await cookies()).get(DEMO_COOKIE)?.value === "1";
}

export function demoReadOnlyResponse(): Response {
  return Response.json(
    { error: "Demo mode is read-only — switch back to cylrm to make changes." },
    { status: 403 },
  );
}
