import { parseCsv } from './csv-parser';
import type { ImportFileType } from './types';

export interface MappingPreview {
  file: string;
  target: string;
  rowsSampled: number;
  fields: Array<{ source: string; destination: string; example: string }>;
  ignored: string[];
  warning?: string;
  warningDisposition?: 'fatal' | 'skip';
}

// Selective owner importers consume only these normalized CSV columns.
export const OWNER_SELECTED_COLUMNS: Record<string, Record<string, string>> = {
  'profile.csv': { first_name: 'First name', last_name: 'Last name', headline: 'Headline', summary: 'Summary', industry: 'Industry', zip_code: 'ZIP code', geo_location: 'Location', birth_date: 'Birth date', websites: 'Websites', twitter_handles: 'Twitter handles' },
  'email addresses.csv': { primary: 'Primary email selector', email_address: 'Owner email' },
  'phonenumbers.csv': { number: 'Owner phone' },
  'registration.csv': { registered_at: 'Registration date' },
  'skills.csv': { name: 'Owner skill' },
  'company follows.csv': { organization: 'Followed company' },
  'messages.csv': { conversation_id: 'Conversation count', from: 'Sent/received selector' },
  'invitations.csv': { direction: 'Sent/received selector' },
};

export const OWNER_REQUIRED_COLUMNS: Record<string, string[]> = {
  'profile.csv': ['first_name', 'last_name'],
  'email addresses.csv': ['primary', 'email_address'],
  'phonenumbers.csv': ['number'],
  'registration.csv': ['registered_at'],
  'skills.csv': ['name'],
  'company follows.csv': ['organization'],
  'messages.csv': ['from'],
  'invitations.csv': ['direction'],
};

const destinations: Record<ImportFileType, Record<string, string>> = {
  profile: {},
  connections: { first_name: 'Contact first name', last_name: 'Contact last name', url: 'LinkedIn URL', email_address: 'Email', company: 'Company', position: 'Title', connected_on: 'Connection date' },
  messages: { conversation_id: 'Conversation', from: 'Sender', to: 'Recipient', date: 'Message date', subject: 'Subject', content: 'Message text' },
  invitations: { direction: 'Direction', from: 'Sender', to: 'Recipient', name: 'Contact', sent_at: 'Sent date', date: 'Sent date' },
  endorsements: { skill: 'Skill', skill_name: 'Skill', endorser: 'Endorser', endorsee: 'Endorsee', name: 'Contact' },
  recommendations: { recommender: 'Recommender', recommendee: 'Recommendee', name: 'Contact', recommendation: 'Recommendation', text: 'Recommendation' },
  positions: { company_name: 'Work history company', company: 'Work history company', title: 'Work history title', position: 'Work history title', started_on: 'Start date', start_date: 'Start date', finished_on: 'End date', end_date: 'End date', description: 'Description' },
  education: { school_name: 'School', institution: 'School', degree_name: 'Degree', degree: 'Degree', notes: 'Field of study', field_of_study: 'Field of study', start_date: 'Start date', end_date: 'End date' },
  skills: { name: 'Skill', skill: 'Skill', skill_name: 'Skill' },
  company_follows: { organization: 'Followed company', company: 'Followed company', name: 'Followed company' },
};

export function detectContactFileType(filename: string): ImportFileType | null {
  const lower = filename.toLowerCase();
  if (!lower.endsWith('.csv')) return null;
  if (lower.includes('profile')) return /^profile(?:-[0-9a-f-]{36})?\.csv$/.test(lower) ? 'profile' : null;
  if (lower.includes('connection')) return 'connections';
  if (lower.includes('message')) return 'messages';
  if (lower.includes('invitation')) return 'invitations';
  if (lower.includes('endorsement')) return 'endorsements';
  if (lower.includes('recommendation')) return 'recommendations';
  if (lower.includes('position')) return 'positions';
  if (lower.includes('education')) return 'education';
  if (lower.includes('skill')) return 'skills';
  if (lower.includes('company') && lower.includes('follow')) return 'company_follows';
  return null;
}

export function previewContactCsv(filename: string, content: string): MappingPreview | null {
  const type = detectContactFileType(filename);
  if (!type) return null;
  if (type === 'profile') return {
    file: filename, target: 'Owner profile (separate import)', rowsSampled: 0,
    fields: [], ignored: [], warning: 'Skipped by contacts import. Use Import Owner Profile for this file.',
  };
  const parsed = parseCsv(content, type === 'connections' ? { preambleLines: 2 } : {});
  const fieldMap = destinations[type];
  const fields = parsed.headers.filter(header => fieldMap[header]).map(source => ({
    source, destination: fieldMap[source], example: parsed.rows[0]?.[source]?.slice(0, 80) ?? '',
  }));
  return {
    file: filename, target: type.replaceAll('_', ' '), rowsSampled: Math.min(parsed.rows.length, 1),
    fields, ignored: parsed.headers.filter(header => !fieldMap[header]),
    warning: fields.length === 0 ? 'No supported columns found in this sample.' : undefined,
  };
}

export function previewOwnerProfileCsv(filename: string, content: string): MappingPreview | null {
  const lower = filename.toLowerCase();
  if (lower === 'profile summary.csv') return null;
  const deepTargets: Record<string, string> = {
    'profile.csv': 'Owner profile fields', 'email addresses.csv': 'Owner email',
    'phonenumbers.csv': 'Owner phone', 'registration.csv': 'Registration date',
    'skills.csv': 'Owner skills', 'positions.csv': 'Owner positions',
    'education.csv': 'Owner education', 'messages.csv': 'Message counts',
    'invitations.csv': 'Invitation counts',
  };
  const target = deepTargets[lower] ?? 'Owner profile: ' + lower.replace(/\.csv$/, '').replaceAll('_', ' ');
  const parsed = parseCsv(content, { preambleLines: 0 });
  const selected = OWNER_SELECTED_COLUMNS[lower];
  const mapped = parsed.headers.filter(header => !selected || selected[header]).map(source => ({
    source, destination: selected?.[source] ?? `${target} (stored row field)`,
    example: parsed.rows[0]?.[source]?.slice(0, 80) ?? '',
  }));
  const missing = (OWNER_REQUIRED_COLUMNS[lower] ?? []).filter(column => !parsed.headers.includes(column));
  const warning = lower === 'profile.csv' && ![parsed.rows[0]?.first_name, parsed.rows[0]?.last_name].some(name => name?.trim())
    ? 'Profile.csv needs a first or last name before import.'
    : missing.length > 0 && lower !== 'profile.csv' ? `Missing required columns: ${missing.join(', ')}`
    : mapped.length === 0 ? 'No supported columns found in this sample.' : undefined;
  return {
    file: filename, target, rowsSampled: Math.min(parsed.rows.length, 1), fields: mapped,
    ignored: selected ? parsed.headers.filter(header => !selected[header]) : [],
    warning,
    warningDisposition: warning ? lower === 'profile.csv' ? 'fatal' : 'skip' : undefined,
  };
}

export function ownerProfilePreviewReady(previews: MappingPreview[], expectedFiles: number): boolean {
  return previews.length === expectedFiles && previews.some(preview =>
    preview.file.toLowerCase() === 'profile.csv' && preview.fields.length > 0 &&
    preview.warningDisposition !== 'fatal' && !preview.warning
  );
}
