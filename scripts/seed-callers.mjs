// One-off: create the three callers and give each a niche to practise on.
//
//   TEAM_PASSWORD='...' node --env-file=.env scripts/seed-callers.mjs
//
// The password is read from the environment, never passed as an argument: an
// argument is in the shell history and in `ps`, which is the same reason
// bootstrap-admin.mjs does it this way.
//
// Re-running is safe. Accounts are upserted by username, and a caller's list
// is left alone once it has calls logged against it, so nobody's practice is
// wiped by a second run.
//
// The leads are fictional on purpose, drawn from the ranges reserved for it:
// +1 555-01xx in the US and +44 20 7946 0xxx in the UK. Nobody's phone rings.

import { randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";
import postgres from "postgres";

const scrypt = promisify(scryptCb);
const password = process.env.TEAM_PASSWORD;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (run with --env-file=.env).");
  process.exit(1);
}
if (!password || password.length < 8) {
  console.error("TEAM_PASSWORD must be set and at least 8 characters.");
  process.exit(1);
}

/** Matches src/lib/password.ts. */
async function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64, { N: 16384 });
  return `scrypt$16384$${salt.toString("hex")}$${key.toString("hex")}`;
}

// `call_region` is the market they work. The UK is its own market even though
// it reads the US documents: the two scripts differ only on WhatsApp, which UK
// businesses do not use for this either, and `sopRegionFor` does that mapping
// so "who works the UK" stays a question the data can answer.
const CALLERS = [
  { username: "samson", name: "Samson", region: "us", country: "us" },
  { username: "maxi", name: "Maxi", region: "gb", country: "gb" },
  { username: "victoria", name: "Victoria", region: "us", country: "us" },
];

const LISTS = {
  samson: {
    name: "Dental Clinics US",
    niche: "dental",
    companies: [
      ["Brightline Dental", "Karen Whitfield", "Practice Manager"],
      ["Harbor Family Dentistry", "Miguel Santos", "Owner"],
      ["Cedar Park Orthodontics", "Dana Boyle", "Office Manager"],
      ["Redwood Smile Studio", "Priya Raman", "Owner"],
      ["Lakeside Dental Group", "Tom Becker", "Director"],
      ["Northgate Dental Care", "Alicia Moreno", "Practice Manager"],
      ["Summit Family Dental", "Ray Okafor", "Owner"],
      ["Bayview Dental Arts", "Helen Cho", "Office Manager"],
    ],
  },
  maxi: {
    name: "Plumbers UK",
    niche: "trades",
    companies: [
      ["Thameside Plumbing", "Gary Whitmore", "Owner"],
      ["Kingsway Heating", "Denise Clark", "Office Manager"],
      ["Bramley Drains", "Owen Pritchard", "Director"],
      ["Halcyon Boilers", "Sofia Nowak", "Owner"],
      ["Westgate Plumbing", "Ian Fairhurst", "Owner"],
      ["Corbett & Sons", "Marie Corbett", "Office Manager"],
      ["Ashcroft Heating", "Femi Adeyemi", "Director"],
      ["Riverford Plumbing", "Kate Lindsay", "Owner"],
    ],
  },
  victoria: {
    name: "Law Firms US",
    niche: "legal",
    companies: [
      ["Marlowe & Finch LLP", "Grace Ellery", "Office Manager"],
      ["Ridgeway Legal", "Daniel Osei", "Partner"],
      ["Copperfield Law", "Nina Vasquez", "Practice Manager"],
      ["Stonebridge Attorneys", "Peter Halloran", "Partner"],
      ["Fairmont Legal Group", "Yuki Tanaka", "Office Manager"],
      ["Ashworth & Pine", "Marcus Reid", "Partner"],
      ["Beaumont Law Offices", "Clara Nwosu", "Practice Manager"],
      ["Hartley Legal", "Sam Dunning", "Partner"],
    ],
  },
};

/** Reserved-for-fiction ranges, so none of these can reach a real person. */
const phoneFor = (country, i) =>
  country === "gb"
    ? `+44 20 7946 0${String(100 + i).padStart(3, "0")}`
    : `+1 415 555 01${String(10 + i).padStart(2, "0")}`;

/** Mirrors phoneKey() in src/lib/calls.ts: E.164 digits. */
const keyFor = (phone) => phone.replace(/\D/g, "");

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

try {
  for (const c of CALLERS) {
    const hash = await hashPassword(password);
    const [user] = await sql`
      insert into app_user (username, name, password_hash, role, active, call_region)
      values (${c.username}, ${c.name}, ${hash}, 'caller', true, ${c.region})
      on conflict (username) do update
        set name = excluded.name,
            password_hash = excluded.password_hash,
            role = 'caller',
            active = true,
            call_region = excluded.call_region
      returning id, username
    `;

    const spec = LISTS[c.username];
    const [existing] = await sql`
      select id from call_list where name = ${spec.name}
    `;
    const [list] = existing
      ? await sql`
          update call_list set assigned_user_id = ${user.id}, niche = ${spec.niche}
          where id = ${existing.id} returning id
        `
      : await sql`
          insert into call_list (name, niche, assigned_user_id)
          values (${spec.name}, ${spec.niche}, ${user.id})
          returning id
        `;

    const rows = spec.companies.map(([company, name, title], i) => {
      const phone = phoneFor(c.country, i);
      return {
        call_list_id: list.id,
        phone,
        phone_key: keyFor(phone),
        company,
        name,
        title,
        email: `${name.split(" ")[0].toLowerCase()}@${company
          .toLowerCase()
          .replace(/[^a-z]+/g, "")
          .slice(0, 14)}.example`,
      };
    });
    await sql`
      insert into call_lead ${sql(
        rows,
        "call_list_id",
        "phone",
        "phone_key",
        "company",
        "name",
        "title",
        "email",
      )}
      on conflict (call_list_id, phone_key) do nothing
    `;

    const [{ count }] = await sql`
      select count(*)::int as count from call_lead where call_list_id = ${list.id}
    `;
    console.log(
      `${c.name.padEnd(9)} ${c.username.padEnd(9)} region=${c.region}  ->  ${spec.name} (${count} leads)`,
    );
  }
} finally {
  await sql.end();
}
