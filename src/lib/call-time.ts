/**
 * How a zone names itself right now — "EDT", "SGT", "GMT+1".
 *
 * Right now and not in the abstract: an abbreviation is a fact about an
 * instant, not about a zone, and Eastern answers this differently in January
 * and in July.
 */
function shortName(tz: string): string {
  return (
    new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value ?? tz
  );
}

/**
 * Tomorrow at 10am Singapore time — what a callback box opens on.
 *
 * Built from the Singapore date rather than the browser's, because the server
 * reads whatever the field holds as Singapore time: the two have to mean the
 * same thing, or the default alone would shift the appointment.
 *
 * Here rather than in a screen because three of them offer it now — the dial
 * card, the missed-calls row and the callbacks diary — and a default that
 * drifts between them would put the same call in two different diaries.
 */
/**
 * What to put on the callback field so nobody has to guess whose clock it is.
 *
 * Three screens ask for a callback time and all three said "(Singapore time)",
 * which was true and is no longer. Naming the zone matters more now, not less:
 * the same field means a different hour per lead, so a caller who learns the
 * rule on one row must not carry it to the next.
 *
 * A null zone is said out loud rather than papered over. Toll-free numbers
 * belong to no place and an unmapped area code is not worth guessing at, so
 * those fall back to `readerTz` — the clock the reader picked at the top of
 * Stats, Eastern unless they changed it. The label names it either way, because
 * a quiet fallback is how somebody books an evening call believing otherwise.
 */
export function callbackZoneLabel(
  tz: string | null | undefined,
  readerTz: string,
): string {
  const short = shortName(tz || readerTz);
  return tz
    ? `Call back at (${short} — their time)`
    : `Call back at (${short} — your clock, no zone for this number)`;
}

export function defaultCallbackAt(
  tz: string | null | undefined,
  readerTz: string,
): string {
  const zone = tz || readerTz;
  // Tomorrow *where the prospect is*. Built from their date rather than the
  // browser's for the same reason the parse reads their zone: the two have to
  // mean the same thing, or the default alone would shift the appointment. It
  // opened on Singapore's tomorrow for every lead until 2026-09-17, which for a
  // US prospect is the evening of the day before — and past midnight in
  // Singapore it was two evenings before.
  const theirToday = new Date().toLocaleDateString("en-CA", { timeZone: zone });
  const next = new Date(`${theirToday}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return `${next.toISOString().slice(0, 10)}T10:00`;
}

/**
 * What a zone's offset was at a given instant, in minutes.
 *
 * Formatting the instant in the target zone and reassembling those parts as if
 * they were UTC gives a number that differs from the real instant by exactly
 * the offset. Written here because nothing in the app did this: every other
 * `Intl.DateTimeFormat` in `lib/` runs the other way — reading what hour it is
 * somewhere now — and none of them turns a typed wall clock into an instant.
 */
function offsetMinutes(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  // `hour12: false` can render midnight as 24; Date.UTC normalises it.
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return (asUtc - at.getTime()) / 60000;
}

/**
 * "2026-09-17T09:00" in a named zone, as the instant it actually names.
 *
 * Two passes, and the second is not belt-and-braces: the offset has to be
 * looked up *at* the instant being named, and the first guess can land the
 * wrong side of a daylight-saving boundary — which is precisely the case this
 * exists for. A fixed offset string was fine while every callback was Singapore
 * time, because Singapore has had no daylight saving since 1982; America/New_York
 * moves twice a year, so `+08:00` as a constant cannot be reused for it.
 */
export function wallClockIn(wall: string, tz: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(wall);
  if (!m) return null;
  const naive = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] ?? "0"),
  );
  let at = naive - offsetMinutes(new Date(naive), tz) * 60000;
  at = naive - offsetMinutes(new Date(at), tz) * 60000;
  const parsed = new Date(at);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Read a callback time as the wall clock somebody typed, in the prospect's zone.
 *
 * `<input type="datetime-local">` sends "2026-08-06T13:00" with no zone, and
 * `new Date()` reads that as the *server's* local time. On the droplet that is
 * UTC, so 1pm typed in Singapore was stored as 1pm UTC and read back as 9pm —
 * every callback landing eight hours late.
 *
 * **The zone is the prospect's, not the caller's** (2026-09-17). It was
 * Singapore for everybody, which is right for a Singapore lead and wrong for
 * every US one: "9am" typed for a Florida business stored 9pm the previous
 * evening their time. Measured on the live diary the day this changed — 9 of
 * the 12 outstanding callbacks were set outside the prospect's 9 to 5, several
 * at ten at night. The caller reads the diary in a tidy morning slot and rings
 * somebody's evening.
 *
 * `tz` comes from `leadZone`, which already resolves a US state, then the area
 * code, then Singapore and UK by prefix. **Null is a real answer**: toll-free
 * numbers belong to no place, and an unmapped area code is not worth guessing
 * at. Those are read on the reader's own clock, so the caller resolves the
 * fallback and passes one zone — a hidden constant here is how the time a
 * callback is *stored* in drifts from the time it is *shown* in, which is the
 * whole subject of this file.
 *
 * A value that already carries a zone (a `Z` or an offset) is an instant and is
 * passed through untouched.
 */
export function parseCallbackAt(raw: unknown, tz: string): Date | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const value = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) {
    return wallClockIn(value, tz);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
