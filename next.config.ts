import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mail libraries (and pino, pulled in by imapflow) must stay as runtime
  // node_modules requires — Turbopack's hashed externals break for them
  // when the build machine differs from the runtime host.
  serverExternalPackages: ["imapflow", "mailparser", "nodemailer", "pino"],
  // Pin the workspace root: the droplet has stray files in /root that
  // otherwise make Next infer the wrong root at runtime, breaking
  // external-module resolution for the packages above.
  outputFileTracingRoot: __dirname,
  turbopack: { root: __dirname },
  // Which build this is, stamped into the browser's code and the server's
  // alike, so an open tab can tell when the server has moved past the code it
  // is running — see `DeployGuard`. Set by scripts/deploy.sh; a build without
  // it is "dev", which the guard reads as "cannot tell" and never acts on.
  env: { CYLRM_BUILD_ID: process.env.CYLRM_BUILD_ID || "dev" },
};

export default nextConfig;
