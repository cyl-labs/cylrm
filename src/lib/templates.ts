export type MergeContact = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  title: string | null;
};

export const MERGE_FIELDS = [
  "first_name",
  "last_name",
  "company",
  "title",
  "email",
] as const;

/** Replace {{field}} placeholders; unknown fields and empty values become "". */
export function renderTemplate(template: string, contact: MergeContact): string {
  const values: Record<string, string> = {
    first_name: contact.firstName ?? "",
    last_name: contact.lastName ?? "",
    company: contact.company ?? "",
    title: contact.title ?? "",
    email: contact.email,
  };
  return template.replace(
    /\{\{\s*(\w+)\s*\}\}/g,
    (_, field: string) => values[field] ?? "",
  );
}
