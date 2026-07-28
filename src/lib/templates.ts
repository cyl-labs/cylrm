export type MergeContact = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  title: string | null;
};

export type MergeSender = {
  /** Display name of the mailbox the email is going out from. */
  name: string | null;
  email: string;
};

export const MERGE_FIELDS = [
  "first_name",
  "last_name",
  "company",
  "title",
  "email",
  "sender_name",
] as const;

/** Replace {{field}} placeholders; unknown fields and empty values become "".
 *
 * `sender` is the mailbox the email will actually leave from, which the
 * scheduler only knows after account assignment — so a sign-off written as
 * {{sender_name}} always matches the From address rather than whichever
 * person happened to write the copy. */
export function renderTemplate(
  template: string,
  contact: MergeContact,
  sender?: MergeSender,
): string {
  const values: Record<string, string> = {
    first_name: contact.firstName ?? "",
    last_name: contact.lastName ?? "",
    company: contact.company ?? "",
    title: contact.title ?? "",
    email: contact.email,
    sender_name: sender?.name ?? "",
  };
  return template.replace(
    /\{\{\s*(\w+)\s*\}\}/g,
    (_, field: string) => values[field] ?? "",
  );
}
