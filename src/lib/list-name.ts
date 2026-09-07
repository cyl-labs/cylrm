/**
 * What one part of a split list is called.
 *
 * Its own module, with no database import, because both the importer and the
 * review screen have to produce this string and only one of them runs on the
 * server. The review step exists to show exactly what will be created before
 * it exists, so a second copy of the rule is a preview that can quietly stop
 * matching what gets written.
 *
 * `Movers.1`, `Movers.2` — a dot rather than the space it used to be. "Movers
 * 2" reads as a second, unrelated niche called Movers 2; "Movers.2" reads as
 * part two of Movers, which is what it is. It also sorts and reads the way the
 * lists already split by hand do.
 *
 * A trailing dot on the typed name is dropped rather than doubled, so
 * "Movers." does not become "Movers..1".
 */
export function partName(name: string, index: number): string {
  return `${name.trim().replace(/\.+$/, "")}.${index + 1}`;
}
