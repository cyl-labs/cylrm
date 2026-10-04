import { NextResponse } from "next/server";
import postgres from "postgres";
import { hasBearer } from "@/lib/bearer";
import { clientAddress, isThrottled, recordFailure } from "@/lib/login-throttle";

/**
 * Read-only SQL over HTTPS, for Claude Code cloud sessions (2026-10-04).
 *
 * Why it exists: a cloud session can reach the web but not a database port, so
 * neither an SSH tunnel nor a direct Postgres connection works from there (the
 * egress proxy lets HTTPS through and times 5432 out). This is the one door.
 *
 *   curl -s -X POST https://crm.cyllabs.com/api/readonly-sql \
 *     -H "Authorization: Bearer $READONLY_SQL_TOKEN" \
 *     -H "Content-Type: application/json" -d '{"sql":"select count(*) from call"}'
 *
 * What bounds it, because it runs whatever select it is given:
 * - It connects as `cloud_ro` (READONLY_DATABASE_URL), which can only select,
 *   and not from `push_subscription`, `app_user.password_hash` / `.payment_method`
 *   or the `sending_account` credentials. See docs/database.md.
 * - One statement, inside a READ ONLY transaction, 30 seconds, 5,000 rows.
 * - Its own secret (READONLY_SQL_TOKEN), compared in constant time, separate
 *   from CRON_SECRET so either can be changed alone. Wrong tokens are throttled
 *   per address. `/api` is outside the middleware matcher, so this check is the
 *   whole of the gate.
 * - Absent unless both settings exist: unset means 404, nothing else changes.
 */
const ROW_CAP = 5000;
const MAX_SQL_CHARS = 20_000;

const globalForRo = globalThis as unknown as {
  readonlySql?: ReturnType<typeof postgres>;
};

function client() {
  const url = process.env.READONLY_DATABASE_URL;
  if (!url) return null;
  return (globalForRo.readonlySql ??= postgres(url, {
    max: 2,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 15,
  }));
}

export async function POST(request: Request) {
  const sql = client();
  if (!sql || !process.env.READONLY_SQL_TOKEN) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const who = `readonly-sql:${clientAddress(request)}`;
  if (isThrottled(clientAddress(request), who)) {
    return NextResponse.json({ error: "too many wrong tokens, wait" }, { status: 429 });
  }
  if (!hasBearer(request.headers.get("authorization"), process.env.READONLY_SQL_TOKEN)) {
    recordFailure(clientAddress(request), who);
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { sql?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'send JSON: {"sql": "select ..."}' }, { status: 400 });
  }
  if (typeof body.sql !== "string" || !body.sql.trim()) {
    return NextResponse.json({ error: 'send JSON: {"sql": "select ..."}' }, { status: 400 });
  }
  if (body.sql.length > MAX_SQL_CHARS) {
    return NextResponse.json({ error: "query too long" }, { status: 400 });
  }

  // One statement. Postgres refuses two in the extended protocol anyway; this
  // gives a clearer message than its own.
  const query = body.sql.trim().replace(/;+\s*$/, "");
  if (query.includes(";")) {
    return NextResponse.json({ error: "one statement per request, no semicolons inside" }, { status: 400 });
  }

  // Reads only. A `set session ...` would pass the read-only transaction and
  // linger on a pooled connection for the next caller; the transaction already
  // stops every write, so this is about leaving no trace rather than safety.
  if (!/^\s*(select|with|values|show|explain)\b/i.test(query)) {
    return NextResponse.json({ error: "only select, with, values, show or explain" }, { status: 400 });
  }

  // A plain select is wrapped so the cap is enforced by Postgres, not by
  // reading everything and cutting it afterwards. The newlines matter: a query
  // ending in a `--` comment would otherwise swallow the closing bracket.
  const wrappable = /^\s*(select|with|values)\b/i.test(query);
  const text = wrappable
    ? `select * from (\n${query}\n) as q limit ${ROW_CAP + 1}`
    : query;

  const started = Date.now();
  try {
    const rows = await sql.begin("read only", async (tx) => {
      await tx.unsafe("set local statement_timeout = '30s'");
      return tx.unsafe(text);
    });
    const ms = Date.now() - started;
    const truncated = rows.length > ROW_CAP;
    console.log(`[readonly-sql] ${ms}ms ${rows.length} rows: ${query.replace(/\s+/g, " ").slice(0, 160)}`);
    return NextResponse.json({
      rows: truncated ? rows.slice(0, ROW_CAP) : rows,
      rowCount: Math.min(rows.length, ROW_CAP),
      truncated,
      ms,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "query failed";
    console.log(`[readonly-sql] error after ${Date.now() - started}ms: ${message.slice(0, 120)}`);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
