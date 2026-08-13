/**
 * A scraped website turned into something a browser can open.
 *
 * No database import here on purpose: the spreadsheet and the dial card are
 * client components, and `@/lib/calls` would drag the Postgres driver into
 * the browser bundle — the same reason `components/calls/outcome.ts` exists.
 */

/** What a scrape writes when it found no site. Stored as text, so they arrive
 *  as values rather than nulls. */
const PLACEHOLDERS = new Set([
  "",
  "n/a",
  "na",
  "none",
  "null",
  "undefined",
  "-",
  "no website",
  "not found",
  "none found",
]);

/**
 * The value as an openable https URL, or null if it is not one.
 *
 * Scrapes store whatever the page said — `movings.sg`, `www.movings.sg`,
 * `https://movings.sg/contact-us`, and the odd `N/A`. A bare domain is not a
 * URL (`new URL("movings.sg")` throws), so a missing scheme is filled in
 * rather than the value being thrown away.
 *
 * Anything that still will not parse, or parses to a scheme other than
 * http(s), returns null and the button is simply not offered. That check is
 * load-bearing rather than tidiness: this text came off a scraped page, and
 * `javascript:` in an href is a script that runs when someone clicks it.
 */
export function websiteHref(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (PLACEHOLDERS.has(value.toLowerCase())) return null;

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value)
    ? value
    : `https://${value}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // A host with no dot is a note ("website", "see facebook"), not a domain.
  if (!url.hostname.includes(".") || url.hostname.endsWith(".")) return null;

  const href = url.toString();
  // `toString()` puts a slash on a bare domain. Harmless in an href, but this
  // is also what gets stored and shown in a cell, and "movings.sg" reads
  // better than "https://movings.sg/".
  return url.pathname === "/" && !url.search && !url.hash
    ? href.replace(/\/$/, "")
    : href;
}

/** Host and path, without the scheme or a leading www. — the full URL is
 *  noise on a card that already names the company. */
export function websiteLabel(raw: string | null | undefined): string {
  const href = websiteHref(raw);
  if (!href) return (raw ?? "").trim();
  const url = new URL(href);
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  return `${url.hostname.replace(/^www\./, "")}${path}`;
}
