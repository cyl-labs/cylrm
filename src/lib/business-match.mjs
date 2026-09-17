// Which leads look like the same business under a different number.
//
// Plain ESM rather than TypeScript for the reason `handout.mjs` is: the
// importer and the same-business review import it, and a bare-node script run
// on the droplet can too, so there is one set of rules rather than a copy that
// drifts.
//
// **These are suggestions, never removals.** Phone number is still the only
// automatic dedupe. Everything found here is shown to a founder, who ticks the
// ones that really are the same business; nothing leaves a queue on a guess.
// The founders asked for it that way (2026-09-17) because a name match that
// is wrong hides a real prospect from every caller, silently.
//
// Why it exists: a Google Places scrape lists one business once per location
// and tracking number, each with its own place id and phone. Dedupe on the
// number let all of them in. On 2026-09-16 Omar rang "EMPIRE STATE JUNK
// REMOVAL" and then "Empire State Junk Removal NYC" 97 seconds later, on two
// numbers that reach one office, and was asked whether he had not just called.
// His list held five copies of that business, and the CRM held twelve.
//
// Three rules, measured against the 5,238 leads on prod that day:
//
// - **Same name** once case, punctuation and a trailing LLC/Inc are folded
//   away. "Trash Panda Junk Removal" = "Trash Panda junk removal".
// - **One name is another plus more words**, the shorter having at least
//   three: "Empire State Junk Removal" and "... NYC", "... Queens". Two-word
//   names are left out because "Junk Removal" starts half the niche.
// - **Same website**, but only where that site belongs to one state. A shared
//   site is otherwise usually a franchise — Junk King, College Hunks,
//   1-800-GOT-JUNK, SERVPRO all turned up — and franchise locations have
//   different owners who are separate prospects.
//
// The two name rules also need the leads to be in the same place: the same
// state when both scrapes say, otherwise the same area code. "JP junk removal"
// in Houston and "JP's Junk Removal" in Taunton, MA are different companies,
// and a common name ("A1 Junk Removal") recurs across the country. About half
// the junk removal leads carry no state, hence the area code; there is no area
// code to state table, and a same-area-code rule errs toward missing a match
// rather than inventing one.

/**
 * @typedef {object} BusinessEntry
 * @property {string | null} company
 * @property {string | null} website
 * @property {string} phoneKey   Digits only, as `call_lead.phone_key`.
 * @property {string | null} state   As the scrape wrote it, either form.
 * @property {boolean} [unreachable]
 *   Never offered as the business's copy — its latest call said the number is
 *   wrong, so the new number may be the one that works.
 */

/** @typedef {"name" | "prefix" | "website"} MatchReason */

const LEGAL_SUFFIXES = new Set([
  "llc",
  "inc",
  "co",
  "corp",
  "corporation",
  "incorporated",
  "ltd",
  "limited",
  "pte",
  "pllc",
  "lp",
  "llp",
]);

/** The shorter name in a prefix match needs at least this many words. */
export const PREFIX_MIN_WORDS = 3;

/** A site on more leads than this is a chain or a platform, not one firm. */
const HOST_MAX_LEADS = 10;
/** ...or on more area codes than this. */
const HOST_MAX_AREAS = 2;

/**
 * Hosts that many unrelated businesses share. A business on one of these has
 * no site of its own, so the host says nothing about who it is.
 */
const SHARED_HOSTS = [
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "youtube.com",
  "yelp.com",
  "google.com",
  "sites.google.com",
  "g.page",
  "business.site",
  "linktr.ee",
  "nextdoor.com",
  "angi.com",
  "homeadvisor.com",
  "thumbtack.com",
  "bbb.org",
  "yellowpages.com",
  "mapquest.com",
  "wixsite.com",
  "square.site",
  "godaddysites.com",
  "example.com",
];

const STATE_NAMES = {
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas",
  ca: "california", co: "colorado", ct: "connecticut", de: "delaware",
  dc: "district of columbia", fl: "florida", ga: "georgia", hi: "hawaii",
  id: "idaho", il: "illinois", in: "indiana", ia: "iowa", ks: "kansas",
  ky: "kentucky", la: "louisiana", me: "maine", md: "maryland",
  ma: "massachusetts", mi: "michigan", mn: "minnesota", ms: "mississippi",
  mo: "missouri", mt: "montana", ne: "nebraska", nv: "nevada",
  nh: "new hampshire", nj: "new jersey", nm: "new mexico", ny: "new york",
  nc: "north carolina", nd: "north dakota", oh: "ohio", ok: "oklahoma",
  or: "oregon", pa: "pennsylvania", ri: "rhode island", sc: "south carolina",
  sd: "south dakota", tn: "tennessee", tx: "texas", ut: "utah", vt: "vermont",
  va: "virginia", wa: "washington", wv: "west virginia", wi: "wisconsin",
  wy: "wyoming", pr: "puerto rico",
};

/**
 * A business name as comparable words.
 *
 * "JP's" becomes "jps" rather than "jp s", so it stays apart from "JP", and a
 * trailing legal suffix is dropped so "Elite Junk Removal LLC" is the same
 * name as "Elite Junk Removal".
 *
 * @param {string | null | undefined} name
 * @returns {string[]}
 */
export function businessWords(name) {
  if (!name) return [];
  const words = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1])) {
    words.pop();
  }
  return words;
}

/**
 * The site's host, or null when there is none worth comparing.
 *
 * @param {string | null | undefined} website
 * @returns {string | null}
 */
export function websiteHost(website) {
  const raw = website?.trim();
  if (!raw) return null;
  let host;
  try {
    host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname;
  } catch {
    return null;
  }
  host = host.toLowerCase().replace(/^www\./, "");
  if (!host.includes(".")) return null;
  // A council site covers every facility it runs: honolulu.gov is eight
  // transfer stations, none of them one business.
  if (host.endsWith(".gov")) return null;
  for (const shared of SHARED_HOSTS) {
    if (host === shared || host.endsWith(`.${shared}`)) return null;
  }
  return host;
}

/**
 * Where a lead is, as far as the comparison needs.
 *
 * `state` only for US numbers, since that is the only scrape that writes one.
 * `area` is the area code for a US number and the country otherwise, so two
 * Singapore leads always count as the same place.
 *
 * @param {{ phoneKey: string, state: string | null }} lead
 * @returns {{ state: string | null, area: string }}
 */
export function leadPlace({ phoneKey, state }) {
  if (/^1\d{10}$/.test(phoneKey)) {
    const s = state?.trim().toLowerCase() ?? "";
    return {
      state: s ? (STATE_NAMES[s] ?? s) : null,
      area: phoneKey.slice(1, 4),
    };
  }
  if (phoneKey.startsWith("65")) return { state: null, area: "sg" };
  if (phoneKey.startsWith("44")) return { state: null, area: "gb" };
  return { state: null, area: phoneKey.slice(0, 3) };
}

/** @param {{ state: string | null, area: string }} a @param {{ state: string | null, area: string }} b */
function samePlace(a, b) {
  if (a.state && b.state) return a.state === b.state;
  return a.area === b.area;
}

/**
 * For every entry, the earlier entries that look like the same business.
 *
 * Order is the whole contract: an entry is only ever compared with the ones
 * before it, so the importer passes the CRM's leads first and the file's rows
 * after, in file order, and a row can then match either. Entries with no
 * match are absent from the result.
 *
 * @template {BusinessEntry} T
 * @param {T[]} entries
 * @returns {Map<T, { entry: T, reason: MatchReason }[]>}
 */
export function findSameBusiness(entries) {
  const prepared = entries.map((entry) => {
    const words = businessWords(entry.company);
    return {
      entry,
      words,
      name: words.join(" "),
      place: leadPlace(entry),
      host: websiteHost(entry.website),
    };
  });

  // A site is only evidence when it belongs to one place and a handful of
  // leads; otherwise it is a franchise or a platform. Counted over every
  // entry, not just the earlier ones, so the answer does not depend on order.
  // Area codes are counted as well as states because most of a scrape can
  // carry no state: 1-800-GOT-JUNK had one stated location (Honolulu) and
  // five without, which read as a one-state business until the six area
  // codes were counted too. Two are allowed, since one firm often has two.
  /** @type {Map<string, { states: Set<string>, areas: Set<string>, count: number }>} */
  const hostUse = new Map();
  for (const p of prepared) {
    if (!p.host) continue;
    const use = hostUse.get(p.host) ?? {
      states: new Set(),
      areas: new Set(),
      count: 0,
    };
    use.count++;
    if (p.place.state) use.states.add(p.place.state);
    use.areas.add(p.place.area);
    hostUse.set(p.host, use);
  }
  const hostCounts = (/** @type {string} */ host) => {
    const use = hostUse.get(host);
    if (!use) return false;
    return (
      use.states.size <= 1 &&
      use.areas.size <= HOST_MAX_AREAS &&
      use.count <= HOST_MAX_LEADS
    );
  };

  /** @type {Map<string, typeof prepared>} */
  const byName = new Map();
  /** @type {Map<string, typeof prepared>} */
  const byPrefix = new Map();
  /** @type {Map<string, typeof prepared>} */
  const byHost = new Map();
  const push = (
    /** @type {Map<string, typeof prepared>} */ map,
    /** @type {string} */ key,
    /** @type {(typeof prepared)[number]} */ p,
  ) => {
    const list = map.get(key);
    if (list) list.push(p);
    else map.set(key, [p]);
  };

  /** @type {Map<T, { entry: T, reason: MatchReason }[]>} */
  const result = new Map();

  for (const p of prepared) {
    /** @type {{ entry: T, reason: MatchReason }[]} */
    const found = [];
    const seen = new Set();
    const take = (
      /** @type {typeof prepared | undefined} */ candidates,
      /** @type {MatchReason} */ reason,
      /** @type {boolean} */ needPlace,
    ) => {
      for (const c of candidates ?? []) {
        if (seen.has(c) || c.entry.unreachable) continue;
        if (needPlace && !samePlace(p.place, c.place)) continue;
        seen.add(c);
        found.push({ entry: c.entry, reason });
      }
    };

    if (p.name) {
      take(byName.get(p.name), "name", true);
      // An earlier name that this one starts with: "Empire State Junk
      // Removal" when this is "... NYC".
      for (let n = p.words.length - 1; n >= PREFIX_MIN_WORDS; n--) {
        take(byName.get(p.words.slice(0, n).join(" ")), "prefix", true);
      }
      // An earlier name that starts with this one: the same pair, arriving in
      // the other order.
      take(byPrefix.get(p.name), "prefix", true);
    }
    if (p.host && hostCounts(p.host)) {
      // No place check: a site used in one state at most has already said
      // where the business is, and area codes within one firm often differ.
      take(byHost.get(p.host), "website", false);
    }

    if (found.length > 0) result.set(p.entry, found);

    if (p.name) {
      push(byName, p.name, p);
      for (let n = PREFIX_MIN_WORDS; n < p.words.length; n++) {
        push(byPrefix, p.words.slice(0, n).join(" "), p);
      }
    }
    if (p.host) push(byHost, p.host, p);
  }

  return result;
}
