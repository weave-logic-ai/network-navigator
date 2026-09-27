export interface ContactIdentity {
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  linkedinUrl?: string | null;
}

export interface ContactIdentityRow {
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  linkedin_url: string | null;
  degree: number | null;
  is_archived: boolean | null;
}

export function identityFromRow(row: ContactIdentityRow): ContactIdentity {
  return {
    fullName: row.full_name,
    firstName: row.first_name,
    lastName: row.last_name,
    linkedinUrl: row.linkedin_url,
  };
}

const PLACEHOLDER_NAMES = new Set([
  'unknown', 'unknown contact', 'unknown person', 'unknown profile',
  'na', 'n/a', 'not available', 'null', 'undefined',
]);
// Match the explicit ASCII whitespace set in the SQL BTRIM/REGEXP_REPLACE
// expressions below and in migration 056.
const NAME_WHITESPACE = /[ \t\n\r\f\v]+/g;
const PLACEHOLDER_PROFILE = /^(unknown(?:[-_](?:contact|person|profile))?|n-a)$/i;
// Keep this URL shape identical to CONTACT_RECOMMENDATION_ELIGIBLE_SQL and 056.
// LinkedIn profile slugs are ASCII; encoded slugs cannot silently bypass SQL.
const PROFILE_URL = /^https:\/\/([a-z0-9-]+\.)*linkedin\.com\/(in|pub)\/([a-z0-9._~-]+)\/?([?#].*)?$/i;

export function isSelfContact(contact: ContactIdentity): boolean {
  return /^self:/i.test(contact.linkedinUrl?.trim() ?? '');
}

function realName(value: string | null | undefined): string | null {
  const name = value?.replace(NAME_WHITESPACE, ' ').replace(/^ +| +$/g, '');
  return name && !PLACEHOLDER_NAMES.has(name.toLowerCase())
    ? name
    : null;
}

export function contactDisplayName(contact: ContactIdentity): string | null {
  return realName(contact.fullName) ??
    realName([contact.firstName, contact.lastName].filter(Boolean).join(' '));
}

export function hasLinkedIdentity(contact: ContactIdentity): boolean {
  if (!contactDisplayName(contact) || !contact.linkedinUrl || isSelfContact(contact)) return false;
  const match = PROFILE_URL.exec(contact.linkedinUrl);
  return !!match && !PLACEHOLDER_PROFILE.test(match[3]);
}

export function isExternalContact(row: ContactIdentityRow): boolean {
  const identity = identityFromRow(row);
  return row.is_archived === false && (row.degree ?? 0) > 0 &&
    !isSelfContact(identity);
}

export function isRecommendationEligible(row: ContactIdentityRow): boolean {
  return isExternalContact(row) && hasLinkedIdentity(identityFromRow(row));
}

// Applied before LIMIT in goal checks so invalid high-ranked rows do not hide
// a valid contact. Recheck selected rows with hasLinkedIdentity in application code.
export const CONTACT_RECOMMENDATION_ELIGIBLE_SQL = String.raw`
  c.is_archived = FALSE AND c.degree > 0
  AND c.linkedin_url ~* '^https://([a-z0-9-]+[.])*linkedin[.]com/(in|pub)/[a-z0-9._~-]+/?([?#].*)?$'
  AND c.linkedin_url !~* '/(in|pub)/(unknown([_-](contact|person|profile))?|n-a)(/|[?#]|$)'
  AND (
    (NULLIF(BTRIM(c.full_name, E' \t\n\r\f\v'), '') IS NOT NULL
     AND LOWER(REGEXP_REPLACE(BTRIM(c.full_name, E' \t\n\r\f\v'),
       E'[ \t\n\r\f\v]+', ' ', 'g'))
       NOT IN ('unknown', 'unknown contact', 'unknown person', 'unknown profile',
               'na', 'n/a', 'not available', 'null', 'undefined'))
    OR
    (NULLIF(BTRIM(CONCAT_WS(' ', c.first_name, c.last_name), E' \t\n\r\f\v'), '') IS NOT NULL
     AND LOWER(REGEXP_REPLACE(BTRIM(CONCAT_WS(' ', c.first_name, c.last_name),
       E' \t\n\r\f\v'), E'[ \t\n\r\f\v]+', ' ', 'g'))
       NOT IN ('unknown', 'unknown contact', 'unknown person', 'unknown profile',
               'na', 'n/a', 'not available', 'null', 'undefined'))
  )`;
