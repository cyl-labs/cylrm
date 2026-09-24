/**
 * Which build the server is running (2026-09-25), asked by every open tab so
 * it can tell whether its own code is still current — see `DeployGuard`.
 *
 * Stamped in at build time by `next.config.ts`, so it names the build this
 * process is running rather than whatever is on disk. Open to anyone, like the
 * login page: it is a date and a commit.
 */
export function GET() {
  return Response.json(
    { build: process.env.CYLRM_BUILD_ID ?? "dev" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
