/**
 * Which time zone a US state is in, where the state has only one.
 *
 * Exists because the area code is a proxy and the address is the fact. A
 * number says where it was *issued*; a business that moved states keeps its
 * mobile, so the clock built from the area code then points at the wrong
 * place. Measured on the live data: 21 leads whose listed state disagrees with
 * their number's, two of them by more than four hours — a Fairbanks business
 * on a Florida number reading Eastern, and a Wahiawa one on a Virginia number
 * reading Eastern when Hawaii is six hours behind it. Ringing that second one
 * "at 9am" is a call at 3am.
 *
 * **Only unambiguous states are here, and that is the whole design.** Within
 * the right state an area code is the more precise of the two, so the state
 * may only override where it cannot be more precise — i.e. where the state has
 * exactly one zone. The genuinely split states are listed below and left out,
 * so a lead in them keeps the area code's answer.
 *
 * Kept in TypeScript rather than a table, unlike `us_area_code`. That one is a
 * table because 368 rows of volatile data want seeding and updating; this is
 * 40 rows of geography that has not moved in decades, and rendering it into
 * the query costs nothing while a table would cost a migration, a seed script
 * and a deploy ordering.
 */

/**
 * The split states, deliberately absent from the map below.
 *
 * Each has a large minority region in a second zone — the Florida panhandle,
 * El Paso, north Idaho — big enough that picking the majority would be
 * inventing an answer for a real share of leads. The area code is better
 * there, being narrower than a state.
 *
 * Not the same judgement as the near-unanimous ones that *are* included:
 * Michigan's four Central counties and Oregon's Malheur County are rounding
 * errors, and the same majority rule `us_area_code` already documents applies.
 */
export const SPLIT_STATES = [
  "florida",
  "texas",
  "tennessee",
  "kentucky",
  "indiana",
  "kansas",
  "nebraska",
  "north dakota",
  "south dakota",
  "idaho",
] as const;

/** Full name and postal abbreviation both, because the scrapes write either. */
export const STATE_TZ: Record<string, string> = {
  alabama: "America/Chicago",
  al: "America/Chicago",
  alaska: "America/Anchorage",
  ak: "America/Anchorage",
  arizona: "America/Phoenix",
  az: "America/Phoenix",
  arkansas: "America/Chicago",
  ar: "America/Chicago",
  california: "America/Los_Angeles",
  ca: "America/Los_Angeles",
  colorado: "America/Denver",
  co: "America/Denver",
  connecticut: "America/New_York",
  ct: "America/New_York",
  delaware: "America/New_York",
  de: "America/New_York",
  "district of columbia": "America/New_York",
  dc: "America/New_York",
  georgia: "America/New_York",
  ga: "America/New_York",
  hawaii: "Pacific/Honolulu",
  hi: "Pacific/Honolulu",
  illinois: "America/Chicago",
  il: "America/Chicago",
  iowa: "America/Chicago",
  ia: "America/Chicago",
  louisiana: "America/Chicago",
  la: "America/Chicago",
  maine: "America/New_York",
  me: "America/New_York",
  maryland: "America/New_York",
  md: "America/New_York",
  massachusetts: "America/New_York",
  ma: "America/New_York",
  michigan: "America/Detroit",
  mi: "America/Detroit",
  minnesota: "America/Chicago",
  mn: "America/Chicago",
  mississippi: "America/Chicago",
  ms: "America/Chicago",
  missouri: "America/Chicago",
  mo: "America/Chicago",
  montana: "America/Denver",
  mt: "America/Denver",
  nevada: "America/Los_Angeles",
  nv: "America/Los_Angeles",
  "new hampshire": "America/New_York",
  nh: "America/New_York",
  "new jersey": "America/New_York",
  nj: "America/New_York",
  "new mexico": "America/Denver",
  nm: "America/Denver",
  "new york": "America/New_York",
  ny: "America/New_York",
  "north carolina": "America/New_York",
  nc: "America/New_York",
  ohio: "America/New_York",
  oh: "America/New_York",
  oklahoma: "America/Chicago",
  ok: "America/Chicago",
  oregon: "America/Los_Angeles",
  or: "America/Los_Angeles",
  pennsylvania: "America/New_York",
  pa: "America/New_York",
  "puerto rico": "America/Puerto_Rico",
  pr: "America/Puerto_Rico",
  "rhode island": "America/New_York",
  ri: "America/New_York",
  "south carolina": "America/New_York",
  sc: "America/New_York",
  utah: "America/Denver",
  ut: "America/Denver",
  vermont: "America/New_York",
  vt: "America/New_York",
  virginia: "America/New_York",
  va: "America/New_York",
  washington: "America/Los_Angeles",
  wa: "America/Los_Angeles",
  "west virginia": "America/New_York",
  wv: "America/New_York",
  wisconsin: "America/Chicago",
  wi: "America/Chicago",
  wyoming: "America/Denver",
  wy: "America/Denver",
};
