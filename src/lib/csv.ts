// Minimal RFC 4180 CSV parser: quoted fields, escaped quotes, embedded
// newlines, CRLF/LF line endings. Returns rows as arrays of strings.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  // Strip UTF-8 BOM
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else if (ch === '"') {
      inQuotes = true;
      i++;
    } else if (ch === ",") {
      row.push(field);
      field = "";
      i++;
    } else if (ch === "\r" || ch === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1;
    } else {
      field += ch;
      i++;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully-empty trailing lines
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export type CsvRecord = Record<string, string>;

// First row is the header; returns one object per data row keyed by header.
export function csvToRecords(text: string): {
  headers: string[];
  records: CsvRecord[];
} {
  const rows = parseCsv(text);
  if (rows.length === 0) return { headers: [], records: [] };
  const headers = rows[0].map((h) => h.trim());
  const records = rows.slice(1).map((cells) => {
    const rec: CsvRecord = {};
    headers.forEach((h, idx) => {
      if (h !== "") rec[h] = (cells[idx] ?? "").trim();
    });
    return rec;
  });
  return { headers, records };
}
