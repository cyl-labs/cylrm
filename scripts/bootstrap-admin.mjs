#!/usr/bin/env node
/**
 * Create the first admin, so there is somebody to sign in as.
 *
 * Run once on the droplet after applying 2026-08-13-app-user.sql:
 *
 *   cd /root/crm && node scripts/bootstrap-admin.mjs <username> "<Display Name>"
 *
 * The password is read from APP_PASSWORD in the environment rather than the
 * command line: it is the one the team already knows, and an argument would
 * be in the shell history and in `ps` for anyone on the box. Nothing prints
 * it back.
 *
 * Re-running with an existing username resets that account's password to
 * APP_PASSWORD and makes it an admin — the way back in if the last admin
 * password is lost.
 *
 * Deliberately standalone: it talks to Postgres directly rather than
 * importing the app, so it works on a droplet that has no build.
 */
import { randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const scrypt = promisify(scryptCb);

// Mirrors lib/password.ts. Duplicated on purpose — see the note above about
// running without a build.
async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, { N: 16384 });
  return `scrypt$16384$${salt.toString("hex")}$${key.toString("hex")}`;
}

/** The app reads .env itself through Next; a plain node script does not. */
function loadEnv(path) {
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const value = m[2].replace(/^["']|["']$/g, "");
      if (process.env[m[1]] === undefined) process.env[m[1]] = value;
    }
  } catch {
    // No .env file is fine if the variables are already exported.
  }
}

const [username, displayName] = process.argv.slice(2);
if (!username || !displayName) {
  console.error(
    'Usage: node scripts/bootstrap-admin.mjs <username> "<Display Name>"',
  );
  process.exit(1);
}

loadEnv(new URL("../.env", import.meta.url).pathname);

const password = process.env.APP_PASSWORD;
if (!password || password.length < 8) {
  console.error("APP_PASSWORD is not set (or is under 8 characters).");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const hash = await hashPassword(password);

const rows = await sql`
  insert into app_user (username, name, password_hash, role, active)
  values (${username.toLowerCase()}, ${displayName}, ${hash}, 'admin', true)
  on conflict (username) do update
    set password_hash = excluded.password_hash,
        role = 'admin',
        active = true
  returning id, username, name
`;

await sql.end();

console.log(
  `Admin ready: ${rows[0].name} signs in as "${rows[0].username}" with the existing APP_PASSWORD.`,
);
