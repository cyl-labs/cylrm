/**
 * Every rule for reading a phone number, and nothing else.
 *
 * Deliberately free of database imports, so a client component can have the
 * same rules the importer uses instead of a second, drifting copy: the boards,
 * the grid and the keypad all reach for these. `lib/calls.ts` re-exports the
 * lot, so existing imports need not care that they moved.
 */

/**
 * The number as it should land on the clipboard: the way somebody standing in
 * that country would key it in.
 *
 * Scraped numbers arrive as "+65 6836 1030", "(+65) 8883 4712", "+6569087475"
 * and "6836 1030" — all the same line. Dialling from a handset in that market
 * the country code is noise at best and a misdial at worst, so it goes, and
 * whatever trunk prefix the country actually uses goes back on.
 *
 * That last part is what this got wrong for two years. It stripped every
 * non-digit — including the leading "+" — and then only ever put Singapore
 * back together. A UK number came out of it as "441322331407": no plus, so not
 * international, and no trunk zero, so not national either. It dials from
 * nowhere at all, and every UK lead on the app was uncopyable because of it.
 * Singapore worked and the United States worked by luck, "1" being the NANP
 * trunk prefix as well as its country code.
 *
 * When the country cannot be established the number is handed back in E.164
 * *with* its plus, which dials from anywhere — rather than as bare digits,
 * which dial from nowhere.
 *
 * `region` is only consulted for a number written without a country code, the
 * same contract `classifyPhone` documents at length: an explicit "+" always
 * wins, being the one part of the string that is not a guess.
 *
 * No database import here — the boards and the grid are client components.
 */
export function dialableNumber(
  raw: string,
  region?: CallRegion | null,
): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return raw.trim();

  switch (classifyPhone(raw, region)) {
    case "sg":
    case "sg_tollfree":
      // 6588834712 → 88834712. An eight-digit local number is already what a
      // Singaporean dials, so it is left alone.
      return digits.length === 10 && digits.startsWith("65")
        ? digits.slice(2)
        : digits;

    case "gb": {
      // 441322331407 → 01322331407. The trunk zero is not decoration: a UK
      // number without it is not a UK number. Freephone is the same shape —
      // 448009949011 → 08009949011 — and 0800 is also the only form some
      // freephone lines will accept at all.
      const national = gbNational(digits);
      return national ? `0${national}` : digits;
    }

    case "us":
      // 19075550123 already dials anywhere in the NANP, 1 being the trunk
      // prefix as well as the country code. A bare ten-digit number dials too,
      // so the eleven-digit form is kept as the one that works from both
      // inside and outside the area code.
      return digits.length === 10 ? `1${digits}` : digits;

    default:
      // Some other country, or nothing we can read.
      //
      // A number that came with a country code keeps it: E.164 with its plus
      // dials from anywhere, and stripping that plus was the whole bug above.
      // One written without a country code is handed back untouched, because
      // there is nothing here to say what country it belongs to and putting a
      // "+" on the front of a national number invents one — "(907) 659-2550"
      // would become "+9076592550", a number in no country at all. Same
      // restraint `withCountryCode` shows on the keypad, and for the same
      // reason: a plus is only ever punctuation when the digits already are a
      // whole international number.
      return /^[^\d]*\+/.test(raw) ? `+${digits}` : digits;
  }
}

/**
 * The market a caller works, set per person on the Team screen.
 *
 * Derived from the lead once, which meant the library had to carry every
 * region at once and labelled, so nobody could tell which was theirs. A caller
 * works one market all day.
 */
export type CallRegion = "sg" | "us" | "gb";
/**
 * The national part of a UK number, or null if this is not one.
 *
 * Scrapes write the trunk prefix that only applies when dialling inside the
 * country — "+44 (0)20 7946 0958" — and keeping that 0 makes a number that
 * cannot be rung from anywhere. Exactly one is stripped.
 */
function gbNational(digits: string): string | null {
  if (!digits.startsWith("44")) return null;
  const rest = digits.slice(2).replace(/^0/, "");
  return rest.length === 9 || rest.length === 10 ? rest : null;
}

/** A UK number as a Briton writes it: "020 7946 0100", trunk zero and all. */
function gbLocal(digits: string): string | null {
  if (!digits.startsWith("0")) return null;
  const rest = digits.slice(1);
  return rest.length === 9 || rest.length === 10 ? rest : null;
}

/**
 * A North American number as an American writes it: "(907) 659-2550".
 *
 * Neither the area code nor the exchange may start with 0 or 1, which is what
 * stops a ten-digit serial number or a mangled string being read as a phone
 * number just because it is the right length.
 */
function nanpNational(digits: string): boolean {
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(digits);
}

/**
 * Which country's phone system this number belongs to.
 *
 * The local eight-digit form has to be tested *before* the "65" country code,
 * because a local landline like 6524 3913 also begins with those two digits.
 * Testing the prefix first brands every 65xx xxxx line malformed.
 *
 * `us` and `gb` require the country code. A bare ten-digit 4155551234 is
 * indistinguishable from Singapore's own 65xxxxxxxx form, so it stays foreign
 * rather than being guessed at and rung wrong.
 *
 * Known collision, left alone deliberately: Singapore toll-free (1800 + 7
 * digits) and US toll-free (+1 800 + 7) are the same eleven digits, so a US
 * 800 number reads as `sg_tollfree`. Preserving the existing rule matters more
 * — the live base is Singapore — and nobody cold-calls a toll-free line.
 */
/**
 * What kind of number is this, read in the market it came from.
 *
 * `defaultRegion` is the list's own market, and it only ever applies to a
 * number written *without* a country code. Most scraped numbers are national
 * format — Google hands back "(907) 659-2550" for a US business — and with no
 * market to read them in there is nothing to say whether that is American,
 * or a mis-typed something else. A US list of 278 once imported four rows for
 * exactly this reason: the only survivors were Puerto Rico and American Samoa
 * listings, where Google happened to supply international format.
 *
 * An explicit "+" always wins over the default, because it is the one thing
 * in the string that is not a guess.
 */
export function classifyPhone(
  raw: string,
  defaultRegion?: CallRegion | null,
): "sg" | "sg_tollfree" | "us" | "gb" | "foreign" | "malformed" | "missing" {
  const cleaned = raw.replace(/[^\d+]/g, "");
  const d = raw.replace(/\D/g, "");
  if (!d) return "missing";

  // Written with a country code: believe it, and never consult the default.
  if (cleaned.startsWith("+")) {
    if (/^\+1\d{10}$/.test(cleaned)) return "us";
    if (/^\+65\d{8}$/.test(cleaned)) return "sg";
    if (gbNational(d)) return "gb";
    return "foreign";
  }

  // Written the way people in that market write it. Checked before the
  // bare-digit rules below because those collide: a US number in area code
  // 650 or 656 is ten digits beginning "65", which is also how a Singapore
  // number with its country code and no plus looks.
  if (defaultRegion === "us") {
    if (nanpNational(d)) return "us";
    if (d.length === 11 && d.startsWith("1") && nanpNational(d.slice(1))) {
      return "us";
    }
  }
  if (defaultRegion === "gb" && gbLocal(d)) return "gb";
  if (defaultRegion === "sg" && d.length === 8 && /^[3689]/.test(d)) return "sg";

  // Country code present but the plus missing, which is how a lot of scrapes
  // write it. Singapore writes its toll-free numbers 1800 xxx xxxx with no
  // country code and the US writes its own +1 800 xxx xxxx; identical once
  // the digits are stripped, which is why the plus is read first above.
  if (d.startsWith("1800")) return "sg_tollfree";
  if (d.length === 8 && /^[3689]/.test(d)) return "sg";
  if (d.length === 10 && d.startsWith("65")) return "sg";
  if (d.length === 11 && d.startsWith("1")) return "us";
  if (gbNational(d)) return "gb";
  return d.startsWith("65") ? "malformed" : "foreign";
}

/** Countries we can present a caller ID for. */
export type DialCountry = "sg" | "us" | "gb";

/**
 * The number in the form Telnyx wants to dial, or null if we cannot build one.
 *
 * Toll-free is null on purpose: Singapore 1800 lines are generally not
 * reachable from outside the country, and offering a dial button that fails is
 * worse than offering none — the copy-to-clipboard button still works.
 */
export function e164(
  raw: string,
  defaultRegion?: CallRegion | null,
): string | null {
  const d = raw.replace(/\D/g, "");
  switch (classifyPhone(raw, defaultRegion)) {
    case "sg":
      return `+65${d.length === 8 ? d : d.slice(2)}`;
    case "us":
      // Ten digits national, eleven with the country code already on it.
      return `+1${d.length === 11 && d.startsWith("1") ? d.slice(1) : d}`;
    case "gb": {
      const national = gbNational(d) ?? gbLocal(d);
      return national ? `+44${national}` : null;
    }
    default:
      return null;
  }
}

/** The country whose DID should be presented when ringing this number. */
export function dialCountry(raw: string): DialCountry | null {
  const kind = classifyPhone(raw);
  return kind === "sg" || kind === "us" || kind === "gb" ? kind : null;
}
