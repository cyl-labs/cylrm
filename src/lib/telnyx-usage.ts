import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * What the phones cost, read from Telnyx's own usage reports.
 *
 * Separate from `lib/telnyx.ts`, which is the calling path — tokens,
 * credentials, the webhook. This is billing: read-only, slow, and wanted by
 * exactly two people once a week. Keeping them apart means a bad hour on the
 * reporting API can never take the dialler down with it.
 *
 * Everything here is Telnyx's arithmetic rather than ours. We could count
 * seconds off `call_recording` and multiply by a rate card, and it would be
 * wrong in all the ways a reimplementation is wrong: unanswered calls, the
 * short-duration surcharge, per-country rates, the second leg of a merge. The
 * bill is the bill.
 */

const API = "https://api.telnyx.com/v2";
const TIMEOUT_MS = 20_000;

/** Unset means the screen says so rather than showing six zeroes — the rule
 *  every optional feature here follows. */
export const usageConfigured = () => Boolean(process.env.TELNYX_API_KEY);

/**
 * How long a pull is good for.
 *
 * Telnyx's numbers settle daily and take several seconds to fetch, so a live
 * read on every page load would spend eight seconds telling a founder the same
 * figure they saw yesterday. An hour is the compromise; the Refresh button is
 * the escape hatch for the minute after somebody tops the balance up.
 *
 * Process-local, which is enough here: one PM2 process, and the cost of being
 * wrong after a restart is one extra pull.
 */
const CACHE_MS = 60 * 60_000;

/** The window the screen opens on. */
export const SPEND_DAYS = 30;

/**
 * The windows the screen offers.
 *
 * A range *picker* was deliberately left off when this was built, on the
 * grounds that the figures are read a handful of times a month to answer "are
 * we fine" and a control that could leave two looks disagreeing was a cost
 * with no matching benefit. The founders asked for one anyway (2026-09-19),
 * and they are right that a month is the wrong and only window for some of
 * the questions — "did last week cost more than the one before" cannot be
 * asked of it at all.
 *
 * Three fixed choices rather than a date-range picker: they cover the
 * questions actually asked, every one of them is a link, and none can be put
 * into a state nobody else can reproduce.
 */
export const SPEND_WINDOWS = [7, 30, 90] as const;
export type SpendDays = (typeof SPEND_WINDOWS)[number];

export const isSpendDays = (n: unknown): n is SpendDays =>
  SPEND_WINDOWS.includes(Number(n) as SpendDays);

export type SpendLine = {
  /** The connection's name, or the person holding it when we can tell. */
  label: string;
  /** Null when the connection belongs to nobody — worth seeing, not hiding. */
  who: string | null;
  cost: number;
  minutes: number;
  calls: number;
};

export type SpendProduct = {
  id: string;
  label: string;
  /** What the number counts — minutes for voice, invocations for lookups. */
  unit: "minutes" | "count";
  used: number;
  cost: number;
};

export type Spend = {
  /** Why there is nothing to show, when there is nothing to show. */
  skipped?: "unconfigured";
  error?: string;
  /** Money left on the account, straight off `/balance`. */
  balance: number | null;
  total: number;
  minutes: number;
  calls: number;
  perDay: number;
  /** Null when there is no balance or no burn to divide it by. */
  daysLeft: number | null;
  products: SpendProduct[];
  lines: SpendLine[];
  daily: { date: string; cost: number }[];
  /** When this was actually pulled, so the screen can say how old it is. */
  fetchedAt: string;
};

type Row = Record<string, unknown>;

/**
 * Waits between tries after Telnyx refuses one.
 *
 * It rate-limits, and until 2026-09-19 nothing here retried: a 429 threw, the
 * caller's `catch` dropped that product, and the screen showed a total short
 * by whatever had failed — with no sign anything had. Forcing the same
 * ninety-day pull three times gave $31.71, $0.00 and $31.71.
 */
const RETRY_MS = [400, 1_200, 3_000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(path: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${API}${path}`, {
        headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      // A timeout or a dropped connection is worth another go; four in a row
      // is the network, not luck.
      if (attempt >= RETRY_MS.length) throw err;
      await sleep(RETRY_MS[attempt]);
      continue;
    }
    if (res.ok) return res.text();
    // 429 and 5xx are "ask again"; a 400 is a request that will never work
    // and retrying it only delays the error by five seconds.
    const again = res.status === 429 || res.status >= 500;
    if (!again || attempt >= RETRY_MS.length) {
      throw new Error(`Telnyx ${res.status} on ${path.split("?")[0]}`);
    }
    await sleep(RETRY_MS[attempt]);
  }
}

/**
 * A usage report, every page of it.
 *
 * **The pagination is the whole reason this helper exists.** The endpoint
 * answers 20 rows by default and says nothing about the rest, so a single
 * request over a thirty-day window silently returns the first twenty
 * day/direction rows and reads as the total. That cost us a wrong figure once:
 * $9.87 where the real spend was $17.40. Ask for 250 and keep going until a
 * page comes back short.
 *
 * Read as TEXT and rewritten before parsing, because connection ids are 19
 * digits — past `Number.MAX_SAFE_INTEGER` — and `JSON.parse` rounds them into
 * a different connection. Quoting them first keeps them as the strings they
 * are everywhere else in this codebase.
 */
/**
 * The longest range Telnyx will report on in one request.
 *
 * Found the day the 90-day window shipped: anything wider answers 400
 * `10004`, "start/end date difference less or equals to 31 days". The screen
 * showed $0.00 and zero calls for the quarter while the pay lines beside it
 * were full, because every report threw and the catches left the figures at
 * zero. A quarter is therefore three requests, not one.
 */
const MAX_REPORT_DAYS = 31;

/** The window split into pieces Telnyx will accept, inclusive of both ends. */
function chunks(startIso: string, endIso: string): [string, string][] {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const first = new Date(startIso.slice(0, 10));
  const last = new Date(endIso.slice(0, 10));
  const out: [string, string][] = [];
  let from = first;
  while (from <= last) {
    const to = new Date(
      Math.min(from.getTime() + (MAX_REPORT_DAYS - 1) * 864e5, last.getTime()),
    );
    out.push([`${day(from)}T00:00:00Z`, `${day(to)}T23:59:59Z`]);
    // The day after, so two chunks never share a date and nothing is counted
    // twice — every caller of this sums what it gets back.
    from = new Date(to.getTime() + 864e5);
  }
  return out;
}

async function report(
  product: string,
  dimensions: string,
  metrics: string,
  startIso: string,
  endIso: string,
): Promise<Row[]> {
  // The chunks go together, the pages inside one cannot: page N+1 is only
  // worth asking for once page N has come back full. Sequentially, a quarter
  // took 69 seconds on prod — three windows times six reports, one after
  // another — which reads as a hung screen however well it is cached
  // afterwards.
  const parts = await Promise.all(
    chunks(startIso, endIso).map(async ([from, to]) => {
      const rows: Row[] = [];
      for (let page = 1; page <= 40; page++) {
        const params = new URLSearchParams({
          product,
          dimensions,
          metrics,
          start_date: from,
          end_date: to,
          "page[number]": String(page),
          "page[size]": "250",
        });
        const text = await get(`/usage_reports?${params}`);
        const safe = text.replace(/"connection_id":\s*(\d+)/g, '"connection_id":"$1"');
        const page_rows = (JSON.parse(safe).data ?? []) as Row[];
        rows.push(...page_rows);
        if (page_rows.length < 250) break;
      }
      return rows;
    }),
  );
  return parts.flat();
}

const num = (v: unknown) => Number(v ?? 0);
const sum = (rows: Row[], key: string) =>
  rows.reduce((a, r) => a + num(r[key]), 0);

/**
 * The products worth a row.
 *
 * Named as the thing rather than as Telnyx's product code: "Calls out" is what
 * a founder is looking for, `sip-trunking` is what the invoice calls it. The
 * two legs are separate lines on purpose — a browser call bills twice, once
 * for the leg to the prospect and once for the caller's own, and a single
 * "minutes" figure hides that.
 */
const PRODUCTS: {
  id: string;
  label: string;
  unit: "minutes" | "count";
  metric: string;
}[] = [
  { id: "sip-trunking", label: "Calls out", unit: "minutes", metric: "billed_sec" },
  { id: "webrtc", label: "Browser line", unit: "minutes", metric: "billed_sec" },
  { id: "recording", label: "Recording", unit: "minutes", metric: "billed_sec" },
  { id: "number-lookup", label: "Number lookups", unit: "count", metric: "invocations" },
  // Texting bills here once the 10DLC campaign clears. Listed now so the row
  // appears the day it starts rather than waiting on a deploy.
  { id: "messaging", label: "Texts", unit: "count", metric: "count" },
];

/** Connection id → whose line it is. The ids are strings for the reason
 *  `report` reads them as text. */
async function lineOwners(): Promise<Map<string, string>> {
  const rows = (await db.execute(sql`
    select telnyx_connection_id, name from app_user
    where telnyx_connection_id is not null
  `)) as Row[];
  return new Map(
    rows.map((r) => [String(r.telnyx_connection_id), String(r.name)]),
  );
}

/**
 * Every connection's name, whatever kind it is.
 *
 * Two endpoints, because Telnyx splits them and neither lists the other:
 * `/connections` covers the credential and FQDN connections the callers dial
 * from, and `/call_control_applications` covers the rest. Asking only the
 * first left `portal-conference-bridge` — another app on the same account,
 * and a busy one — showing as "Line 6317", which reads as a mystery rather
 * than as somebody else's traffic.
 *
 * Names are matched off the raw text rather than parsed objects for the same
 * reason the usage reports are: a 19-digit id does not survive `JSON.parse`.
 */
async function connectionNames(): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const scan = (text: string, field: string) => {
    const a = new RegExp(`"id":"(\\d+)"[^}]*?"${field}":"([^"]+)"`, "g");
    const b = new RegExp(`"${field}":"([^"]+)"[^}]*?"id":"(\\d+)"`, "g");
    for (const m of text.matchAll(a)) if (!names.has(m[1])) names.set(m[1], m[2]);
    for (const m of text.matchAll(b)) if (!names.has(m[2])) names.set(m[2], m[1]);
  };
  for (const [path, field] of [
    ["/connections?page[size]=200", "connection_name"],
    ["/call_control_applications?page[size]=200", "application_name"],
  ] as const) {
    try {
      scan(await get(path), field);
    } catch {
      // Best effort per endpoint: one unreachable list should cost a few
      // labels, never the screen.
    }
  }
  return names;
}

async function pull(days: SpendDays): Promise<Spend> {
  const now = new Date();
  const start = new Date(now.getTime() - days * 864e5);
  const startIso = `${start.toISOString().slice(0, 10)}T00:00:00Z`;
  const endIso = `${now.toISOString().slice(0, 10)}T23:59:59Z`;

  const empty: Spend = {
    balance: null,
    total: 0,
    minutes: 0,
    calls: 0,
    perDay: 0,
    daysLeft: null,
    products: [],
    lines: [],
    daily: [],
    fetchedAt: now.toISOString(),
  };

  let balance: number | null = null;
  try {
    const b = JSON.parse(await get("/balance"));
    balance = Number(b?.data?.balance ?? b?.data?.available_credit ?? NaN);
    if (!Number.isFinite(balance)) balance = null;
  } catch {
    // A balance we could not read is not a reason to withhold the usage.
  }

  const products: SpendProduct[] = [];
  const byDay = new Map<string, number>();
  let total = 0;
  let minutes = 0;
  let calls = 0;
  // Anything that did not come back. A figure short by a failed report is
  // worse than no figure, because it is indistinguishable from a quiet month.
  const failed: string[] = [];

  // One product at a time. Fetching all five at once alongside the chunks put
  // fifteen requests in flight and Telnyx started refusing them, which the
  // catch below then turned into a quietly smaller bill.
  for (const p of PRODUCTS) {
    let rows: Row[];
    try {
      rows = await report(p.id, "date", `cost,${p.metric}`, startIso, endIso);
    } catch (err) {
      // One product failing must not empty the screen — messaging in
      // particular answers oddly before a campaign exists — but it must not
      // pass for zero either. The screen has a banner for exactly this.
      failed.push(`${p.label}: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    const cost = sum(rows, "cost");
    const used =
      p.unit === "minutes" ? sum(rows, p.metric) / 60 : sum(rows, p.metric);
    products.push({ id: p.id, label: p.label, unit: p.unit, used, cost });
    total += cost;
    for (const r of rows) {
      const day = String(r.date ?? "").slice(0, 10);
      if (day) byDay.set(day, (byDay.get(day) ?? 0) + num(r.cost));
    }
  }

  // Minutes and calls are quoted off the outbound leg alone. Adding the
  // browser leg to it would double every call, which is true of the bill and
  // false of the work: 1,200 calls were made, not 2,400.
  try {
    const legs = await report(
      "sip-trunking",
      "date,direction",
      "cost,billed_sec,completed",
      startIso,
      endIso,
    );
    minutes = sum(legs, "billed_sec") / 60;
    calls = sum(legs, "completed");
  } catch (err) {
    failed.push(`minutes: ${err instanceof Error ? err.message : err}`);
  }

  let lines: SpendLine[] = [];
  try {
    const rows = await report(
      "sip-trunking",
      "connection_id,direction",
      "cost,billed_sec,completed",
      startIso,
      endIso,
    );
    const [owners, names] = await Promise.all([lineOwners(), connectionNames()]);
    const byConn = new Map<string, { cost: number; sec: number; calls: number }>();
    for (const r of rows) {
      const id = String(r.connection_id ?? "");
      if (!id) continue;
      const at = byConn.get(id) ?? { cost: 0, sec: 0, calls: 0 };
      at.cost += num(r.cost);
      at.sec += num(r.billed_sec);
      at.calls += num(r.completed);
      byConn.set(id, at);
    }
    lines = [...byConn.entries()]
      .map(([id, v]) => ({
        who: owners.get(id) ?? null,
        label: owners.get(id) ?? names.get(id) ?? `Line ${id.slice(-4)}`,
        cost: v.cost,
        minutes: v.sec / 60,
        calls: v.calls,
      }))
      .sort((a, b) => b.cost - a.cost);
  } catch (err) {
    failed.push(`by line: ${err instanceof Error ? err.message : err}`);
  }

  // Every day in the window, including the ones with nothing on them. A
  // weekend with no calling is a real answer — dropping it would slide the
  // chart's dates and make a quiet Saturday look like a missing one.
  const daily: { date: string; cost: number }[] = [];
  for (let i = days; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 864e5).toISOString().slice(0, 10);
    daily.push({ date: d, cost: byDay.get(d) ?? 0 });
  }

  const perDay = total / (days + 1);
  return {
    ...empty,
    // Said out loud rather than left in the number. The screen already has a
    // banner for a stale pull; this is the same thing for a partial one.
    error: failed.length
      ? `Some figures did not come back from Telnyx (${failed.join("; ")}). The totals below are short by whatever they cover.`
      : undefined,
    balance,
    total,
    minutes,
    calls,
    perDay,
    daysLeft: balance !== null && perDay > 0 ? balance / perDay : null,
    products: products.sort((a, b) => b.cost - a.cost),
    lines,
    daily,
  };
}

// Per window, because each is a separate report out of Telnyx. One shared
// slot would hand a 7-day figure to somebody who asked for 90, and the cache
// would fight the chips rather than serve them.
const cached = new Map<SpendDays, { at: number; value: Spend }>();
const inFlight = new Map<SpendDays, Promise<Spend>>();

/**
 * The figures, from cache unless asked otherwise.
 *
 * Presses landing while a pull is running await that pull rather than starting
 * a second — the same shape `/api/meetings/sync` uses, and for the same
 * reason: the window in which somebody can press twice is exactly the window
 * in which the first request is still going.
 */
export async function getSpend(
  days: SpendDays = SPEND_DAYS,
  force = false,
): Promise<Spend> {
  if (!usageConfigured()) {
    return {
      skipped: "unconfigured",
      balance: null,
      total: 0,
      minutes: 0,
      calls: 0,
      perDay: 0,
      daysLeft: null,
      products: [],
      lines: [],
      daily: [],
      fetchedAt: new Date().toISOString(),
    };
  }
  const hit = cached.get(days);
  if (!force && hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const running = inFlight.get(days);
  if (running) return running;

  const request = pull(days)
    .then((value) => {
      cached.set(days, { at: Date.now(), value });
      return value;
    })
    .catch((err) => {
      // A failed pull keeps the last good numbers rather than blanking the
      // screen: stale and labelled beats empty and unexplained.
      const message = err instanceof Error ? err.message : String(err);
      const last = cached.get(days);
      if (last) return { ...last.value, error: message };
      return {
        error: message,
        balance: null,
        total: 0,
        minutes: 0,
        calls: 0,
        perDay: 0,
        daysLeft: null,
        products: [],
        lines: [],
        daily: [],
        fetchedAt: new Date().toISOString(),
      } satisfies Spend;
    })
    .finally(() => {
      inFlight.delete(days);
    });

  inFlight.set(days, request);
  return request;
}
