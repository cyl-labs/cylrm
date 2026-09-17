// A business's own opening hours, as the Google Places scrape lists them.
//
// Plain ESM rather than TypeScript for the reason `handout.mjs` is: the
// importer and the dial card use it, and so does the backfill script, which
// runs under bare node on the droplet. One parser, so a lead imported today
// and a lead backfilled last week are read the same way.
//
// Why it exists (2026-09-17): the dialler only handed out a lead between 9 and
// 5 its own time, and Akshansh pointed out most of the businesses he rings are
// open until 6. Measured the same day, of the leads carrying hours, about 80
// close before 5 PM on a Monday, 240 at 5, about 200 between 5:30 and 6:30,
// and about 650 at 7 or later. So where the scrape says, the queue now follows
// the business's own hours, and 9 to 6 everywhere else. The rule itself is
// `withinLeadHours` in `lib/calls.ts`; see `docs/lead-hours.md`.
//
// Apify's Google Places export writes a week as fourteen flat columns,
// `openingHours/0/day` = "Monday" and `openingHours/0/hours` =
// "7 AM to 4:30 PM", Monday first. Every form seen on 1,827 leads:
//
//   "7 AM to 4:30 PM"                 7,796 day entries
//   "Open 24 hours"                   3,502
//   "Closed"                            814
//   "7 AM to 12 AM"                     107   (12 AM closing = midnight)
//   "5 to 10 PM"                         74   (start takes the end's AM/PM)
//   "8:15 AM to 12 PM, 12:30 to 4 PM"    6   (split day)
//   "12 to 6 AM, 7 AM to 12 AM"          7
//
// The space before AM/PM is U+202F, a narrow no-break space, not a plain one.

/** @typedef {[string, string]} OpenRange  "HH:MM" to "HH:MM"; the end may be "24:00". */
/** @typedef {Record<string, OpenRange[]>} WeeklyHours  ISO weekday "1" (Monday) to "7" (Sunday). An empty list is closed that day. */

const DAY_KEYS = {
  monday: "1",
  tuesday: "2",
  wednesday: "3",
  thursday: "4",
  friday: "5",
  saturday: "6",
  sunday: "7",
};

const RANGE =
  /^(\d{1,2})(?::(\d{2}))?\s*([ap]m)?\s*(?:to|-)\s*(\d{1,2})(?::(\d{2}))?\s*([ap]m)$/i;

const pad = (n) => String(n).padStart(2, "0");

/** Minutes past midnight from a 12-hour reading, or null if it is not one. */
function minutes(hour, minute, meridiem) {
  const h = Number(hour);
  const m = minute === undefined ? 0 : Number(minute);
  if (!(h >= 1 && h <= 12) || !(m >= 0 && m <= 59)) return null;
  return ((h % 12) + (meridiem.toLowerCase() === "pm" ? 12 : 0)) * 60 + m;
}

const clock = (total) => `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;

/**
 * One day's hours: a list of ranges, `[]` for closed, or null when the text is
 * empty or not a form this has been taught.
 *
 * A closing time at or before the opening one runs past midnight; the part
 * after midnight is dropped, since the calling window never reaches it.
 *
 * @param {string | null | undefined} text
 * @returns {OpenRange[] | null}
 */
export function parseDayHours(text) {
  const t = String(text ?? "")
    .replace(/[    ]/g, " ")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;
  if (/^closed$/i.test(t)) return [];
  if (/^open 24 hours$/i.test(t)) return [["00:00", "24:00"]];

  /** @type {OpenRange[]} */
  const ranges = [];
  for (const part of t.split(",")) {
    const m = part.trim().match(RANGE);
    if (!m) return null;
    const [, sh, sm, smer, eh, em, emer] = m;
    // Google leaves the start's AM/PM off when it matches the end's.
    const start = minutes(sh, sm, smer ?? emer);
    let end = minutes(eh, em, emer);
    if (start === null || end === null) return null;
    if (end <= start) end = 24 * 60;
    ranges.push([clock(start), end === 24 * 60 ? "24:00" : clock(end)]);
  }
  return ranges.sort((a, b) => a[0].localeCompare(b[0]));
}

/**
 * The week from a scraped row, or null when it does not carry one we trust.
 *
 * All seven days must be present and readable; one unreadable day makes the
 * whole week null rather than half-believed, and the lead falls back to the
 * default window. So does a week closed every day, which would otherwise
 * leave a lead that can never be rung.
 *
 * @param {Record<string, unknown> | null | undefined} fields
 * @returns {WeeklyHours | null}
 */
export function openingHoursFromScrape(fields) {
  if (!fields) return null;
  /** @type {WeeklyHours} */
  const week = {};
  for (let i = 0; i < 7; i++) {
    const day = String(fields[`openingHours/${i}/day`] ?? "").trim().toLowerCase();
    const key = DAY_KEYS[day];
    if (!key) return null;
    const ranges = parseDayHours(/** @type {string} */ (fields[`openingHours/${i}/hours`]));
    if (ranges === null) return null;
    week[key] = ranges;
  }
  if (Object.keys(week).length !== 7) return null;
  if (Object.values(week).every((r) => r.length === 0)) return null;
  return week;
}

/** "7 AM", "4:30 PM", "noon", "midnight". */
function spoken(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  if ((h === 0 || h === 24) && m === 0) return "midnight";
  if (h === 12 && m === 0) return "noon";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m ? `:${pad(m)}` : ""} ${h < 12 ? "AM" : "PM"}`;
}

/**
 * A day's hours the way a person says them: "7 AM to 4:30 PM", "Closed",
 * "Open 24 hours".
 *
 * @param {OpenRange[]} ranges
 * @returns {string}
 */
export function describeDayHours(ranges) {
  if (ranges.length === 0) return "Closed";
  if (ranges.length === 1 && ranges[0][0] === "00:00" && ranges[0][1] === "24:00") {
    return "Open 24 hours";
  }
  return ranges.map(([a, b]) => `${spoken(a)} to ${spoken(b)}`).join(", ");
}
