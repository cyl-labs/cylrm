import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  dbClient: ReturnType<typeof postgres> | undefined;
};

// One client for the whole process, in production as well as dev (2026-10-04).
// It was only cached outside production, on the reasoning that production has no
// hot reload to survive. But Next builds this module into several server chunks,
// each of which runs it once, so production quietly held several pools of its
// own: with `max: 10` the live app sat on 15 connections. Invisible against the
// local database (about 100 allowed), fatal against Supabase's session pooler,
// which allows 15 in all and then refuses every other client, deploy scripts
// and the cloud endpoint included (EMAXCONNSESSION). `DB_POOL_MAX` lowers it;
// idle connections are let go so a quiet floor holds none.
const client =
  globalForDb.dbClient ??
  postgres(process.env.DATABASE_URL!, {
    max: Number(process.env.DB_POOL_MAX) || 10,
    idle_timeout: 30,
  });

globalForDb.dbClient = client;

export const db = drizzle(client, { schema });
export * as schema from "./schema";
