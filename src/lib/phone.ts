/**
 * The number as it should land on the clipboard.
 *
 * Scraped Singapore numbers arrive as "+65 6836 1030", "(+65) 8883 4712",
 * "+6569087475" and "6836 1030" — all the same line. Dialling from a Singapore
 * handset the country code is noise at best and a misdial at worst, so it is
 * stripped and the digits handed over bare, ready to paste into a keypad.
 *
 * Anything that is not a ten-digit number starting 65 is left alone bar its
 * punctuation: an eight-digit local number already is what you dial, and a
 * foreign number would be broken by having two digits cut off the front.
 *
 * No database import here — the boards and the grid are client components.
 */
export function dialableNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("65")) return digits.slice(2);
  return digits;
}
