// Part 14: Terms & Privacy screen + acceptance. The texts are edited in Admin > Settings > Legal.
import { sql } from "../db.js";
import { getConfig } from "../runtime.js";
import { DEFAULT_TERMS, DEFAULT_PRIVACY, termsAccepted } from "../terms.js";

export const terms = async ({ row }) => {
  const c = await getConfig();
  return {
    required: c.termsRequired, version: c.termsVersion,
    accepted: termsAccepted(row, c.termsVersion), accepted_at: row.terms_accepted_at || null,
    terms: c.termsText || DEFAULT_TERMS, privacy: c.privacyText || DEFAULT_PRIVACY,
  };
};

export const termsAccept = async ({ id }) => {
  const c = await getConfig();
  await sql`UPDATE users SET terms_version_accepted=${c.termsVersion}::int, terms_accepted_at=NOW() WHERE telegram_id=${id}::bigint`;
  return { accepted: true, version: c.termsVersion };
};
