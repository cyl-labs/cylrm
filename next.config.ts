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
};

export default nextConfig;
