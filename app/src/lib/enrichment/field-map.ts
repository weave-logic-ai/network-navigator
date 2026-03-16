// Map enrichment field names to contacts table column names
// Shared between enrich and apply routes

// Values that indicate a field is effectively empty (e.g. boolean flags from import)
const EMPTY_SENTINEL_VALUES = new Set(['true', 'false', 'null', 'undefined', 'N/A', 'n/a', '']);

export function isEffectivelyEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && EMPTY_SENTINEL_VALUES.has(value.trim())) return true;
  return false;
}

export const FIELD_TO_COLUMN: Record<string, string> = {
  email: 'email',
  phone: 'phone',
  title: 'title',
  current_company: 'current_company',
  location: 'location',
  headline: 'headline',
  about: 'about',
  linkedin_url: 'linkedin_url',
  connections_count: 'connections_count',
  tags: 'tags',
  // Note: 'industry' is not in the contacts table — stored on companies instead
};

export const FIELD_LABELS: Record<string, string> = {
  email: 'Email',
  phone: 'Phone',
  title: 'Job Title',
  current_company: 'Company',
  location: 'Location',
  headline: 'Headline',
  about: 'Bio',
  linkedin_url: 'LinkedIn URL',
  connections_count: 'Connections',
  tags: 'Tags',
};
