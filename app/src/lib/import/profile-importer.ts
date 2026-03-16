// Full LinkedIn export profile importer
// Parses all CSV files from a LinkedIn data export to build a deep owner profile

import { readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';
import { PoolClient } from 'pg';
import { parseCsv } from './csv-parser';

interface OwnerProfileData {
  // Core
  firstName?: string;
  lastName?: string;
  headline?: string;
  summary?: string;
  industry?: string;
  location?: string;
  geoLocation?: string;
  zipCode?: string;
  birthDate?: string;
  email?: string;
  phone?: string;
  twitterHandles: string[];
  websites: string[];
  registeredAt?: string;
  // Ad targeting
  adTargeting: Record<string, unknown>;
  // Structured data
  skills: string[];
  certifications: Array<Record<string, string>>;
  honors: Array<Record<string, string>>;
  organizations: Array<Record<string, string>>;
  volunteering: Array<Record<string, string>>;
  projects: Array<Record<string, string>>;
  courses: Array<Record<string, string>>;
  events: Array<Record<string, string>>;
  positions: Array<Record<string, string>>;
  education: Array<Record<string, string>>;
  learningCourses: Array<Record<string, string>>;
  companyFollows: string[];
  savedJobAlerts: Array<Record<string, string>>;
  endorsementsGiven: Array<Record<string, string>>;
  endorsementsReceived: Array<Record<string, string>>;
  recommendationsGiven: Array<Record<string, string>>;
  recommendationsReceived: Array<Record<string, string>>;
  richMedia: Array<Record<string, string>>;
  receipts: Array<Record<string, string>>;
  // Message stats
  totalMessagesSent: number;
  totalMessagesReceived: number;
  totalConversations: number;
  // Invitation stats
  invitationsSent: number;
  invitationsReceived: number;
  // Files processed
  importedFiles: string[];
}

function emptyProfile(): OwnerProfileData {
  return {
    twitterHandles: [],
    websites: [],
    adTargeting: {},
    skills: [],
    certifications: [],
    honors: [],
    organizations: [],
    volunteering: [],
    projects: [],
    courses: [],
    events: [],
    positions: [],
    education: [],
    learningCourses: [],
    companyFollows: [],
    savedJobAlerts: [],
    endorsementsGiven: [],
    endorsementsReceived: [],
    recommendationsGiven: [],
    recommendationsReceived: [],
    richMedia: [],
    receipts: [],
    totalMessagesSent: 0,
    totalMessagesReceived: 0,
    totalConversations: 0,
    invitationsSent: 0,
    invitationsReceived: 0,
    importedFiles: [],
  };
}

// Parse each file type into the profile
async function parseProfileCsv(content: string): Promise<Partial<OwnerProfileData>> {
  const parsed = parseCsv(content, { preambleLines: 0 });
  if (parsed.rows.length === 0) return {};
  const row = parsed.rows[0];
  return {
    firstName: row.first_name,
    lastName: row.last_name,
    headline: row.headline,
    summary: row.summary,
    industry: row.industry,
    zipCode: row.zip_code,
    geoLocation: row.geo_location,
    birthDate: row.birth_date,
    twitterHandles: row.twitter_handles ? row.twitter_handles.split(';').map(s => s.trim()).filter(Boolean) : [],
    websites: row.websites ? row.websites.split(';').map(s => s.trim()).filter(Boolean) : [],
  };
}

async function parseEmailsCsv(content: string): Promise<string | undefined> {
  const parsed = parseCsv(content, { preambleLines: 0 });
  const primary = parsed.rows.find(r => r.primary?.toLowerCase() === 'yes');
  return primary?.email_address;
}

async function parsePhonesCsv(content: string): Promise<string | undefined> {
  const parsed = parseCsv(content, { preambleLines: 0 });
  const phone = parsed.rows.find(r => r.number?.trim());
  return phone?.number?.trim() || undefined;
}

async function parseRegistrationCsv(content: string): Promise<string | undefined> {
  const parsed = parseCsv(content, { preambleLines: 0 });
  return parsed.rows[0]?.registered_at;
}

function parseSimpleCsv(content: string): Array<Record<string, string>> {
  const parsed = parseCsv(content, { preambleLines: 0 });
  return parsed.rows;
}

function parseAdTargetingCsv(content: string): Record<string, unknown> {
  const parsed = parseCsv(content, { preambleLines: 0 });
  if (parsed.rows.length === 0) return {};

  const row = parsed.rows[0];
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    if (!value?.trim()) continue;
    // Split semicolon-delimited values into arrays
    if (value.includes(';')) {
      result[key] = value.split(';').map(s => s.trim()).filter(Boolean);
    } else {
      result[key] = value.trim();
    }
  }

  return result;
}

function countMessages(content: string, selfName: string): { sent: number; received: number; conversations: number } {
  const parsed = parseCsv(content, { preambleLines: 0 });
  let sent = 0;
  let received = 0;
  const convos = new Set<string>();

  for (const row of parsed.rows) {
    if (row.conversation_id) convos.add(row.conversation_id);
    const from = (row.from || '').toLowerCase();
    if (selfName && from.includes(selfName.toLowerCase())) {
      sent++;
    } else {
      received++;
    }
  }

  return { sent, received, conversations: convos.size };
}

function countInvitations(content: string): { sent: number; received: number } {
  const parsed = parseCsv(content, { preambleLines: 0 });
  let sent = 0;
  let received = 0;

  for (const row of parsed.rows) {
    if (row.direction === 'OUTGOING') sent++;
    else received++;
  }

  return { sent, received };
}

// File type detection mapping
const FILE_PARSERS: Record<string, string> = {
  'profile.csv': 'profile',
  'email addresses.csv': 'email',
  'phonenumbers.csv': 'phone',
  'registration.csv': 'registration',
  'ad_targeting.csv': 'ad_targeting',
  'skills.csv': 'skills',
  'certifications.csv': 'certifications',
  'honors.csv': 'honors',
  'organizations.csv': 'organizations',
  'volunteering.csv': 'volunteering',
  'projects.csv': 'projects',
  'courses.csv': 'courses',
  'events.csv': 'events',
  'positions.csv': 'positions',
  'education.csv': 'education',
  'learning.csv': 'learning',
  'company follows.csv': 'company_follows',
  'savedjob alerts.csv': 'saved_job_alerts',
  'savedjobalerts.csv': 'saved_job_alerts',
  'endorsement_given_info.csv': 'endorsements_given',
  'endorsement_received_info.csv': 'endorsements_received',
  'recommendations_given.csv': 'recommendations_given',
  'recommendations_received.csv': 'recommendations_received',
  'rich_media.csv': 'rich_media',
  'receipts_v2.csv': 'receipts',
  'messages.csv': 'messages',
  'invitations.csv': 'invitations',
};

function detectDeepFileType(filename: string): string | null {
  const lower = filename.toLowerCase();
  return FILE_PARSERS[lower] || null;
}

export async function importFullProfile(
  client: PoolClient,
  directoryPath: string,
): Promise<{
  profileId: string;
  version: number;
  importedFiles: string[];
  skippedFiles: string[];
  selfName: string;
}> {
  const profile = emptyProfile();
  const skippedFiles: string[] = [];

  // Read directory
  const entries = await readdir(directoryPath);
  const csvFiles = entries.filter(name => name.toLowerCase().endsWith('.csv'));

  // Process each file
  for (const filename of csvFiles) {
    const fileType = detectDeepFileType(filename);
    if (!fileType) {
      skippedFiles.push(filename);
      continue;
    }

    const filePath = join(directoryPath, filename);
    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) continue;

      const content = await readFile(filePath, 'utf-8');
      profile.importedFiles.push(filename);

      switch (fileType) {
        case 'profile': {
          const data = await parseProfileCsv(content);
          Object.assign(profile, data);
          break;
        }
        case 'email': {
          const email = await parseEmailsCsv(content);
          if (email) profile.email = email;
          break;
        }
        case 'phone': {
          const phone = await parsePhonesCsv(content);
          if (phone) profile.phone = phone;
          break;
        }
        case 'registration': {
          const regAt = await parseRegistrationCsv(content);
          if (regAt) profile.registeredAt = regAt;
          break;
        }
        case 'ad_targeting':
          profile.adTargeting = parseAdTargetingCsv(content);
          break;
        case 'skills':
          profile.skills = parseSimpleCsv(content).map(r => r.name).filter(Boolean);
          break;
        case 'certifications':
          profile.certifications = parseSimpleCsv(content);
          break;
        case 'honors':
          profile.honors = parseSimpleCsv(content);
          break;
        case 'organizations':
          profile.organizations = parseSimpleCsv(content);
          break;
        case 'volunteering':
          profile.volunteering = parseSimpleCsv(content);
          break;
        case 'projects':
          profile.projects = parseSimpleCsv(content);
          break;
        case 'courses':
          profile.courses = parseSimpleCsv(content);
          break;
        case 'events':
          profile.events = parseSimpleCsv(content);
          break;
        case 'positions':
          profile.positions = parseSimpleCsv(content);
          break;
        case 'education':
          profile.education = parseSimpleCsv(content);
          break;
        case 'learning':
          profile.learningCourses = parseSimpleCsv(content);
          break;
        case 'company_follows':
          profile.companyFollows = parseSimpleCsv(content).map(r => r.organization).filter(Boolean);
          break;
        case 'saved_job_alerts':
          profile.savedJobAlerts = parseSimpleCsv(content);
          break;
        case 'endorsements_given':
          profile.endorsementsGiven = parseSimpleCsv(content);
          break;
        case 'endorsements_received':
          profile.endorsementsReceived = parseSimpleCsv(content);
          break;
        case 'recommendations_given':
          profile.recommendationsGiven = parseSimpleCsv(content);
          break;
        case 'recommendations_received':
          profile.recommendationsReceived = parseSimpleCsv(content);
          break;
        case 'rich_media':
          profile.richMedia = parseSimpleCsv(content);
          break;
        case 'receipts':
          profile.receipts = parseSimpleCsv(content);
          break;
        case 'messages': {
          const selfName = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
          const stats = countMessages(content, selfName);
          profile.totalMessagesSent = stats.sent;
          profile.totalMessagesReceived = stats.received;
          profile.totalConversations = stats.conversations;
          break;
        }
        case 'invitations': {
          const invStats = countInvitations(content);
          profile.invitationsSent = invStats.sent;
          profile.invitationsReceived = invStats.received;
          break;
        }
      }
    } catch {
      skippedFiles.push(filename);
    }
  }

  // Determine version: mark previous versions as non-current
  const prevResult = await client.query<{ max_version: number | null }>(
    'SELECT MAX(version) AS max_version FROM owner_profiles'
  );
  const prevVersion = prevResult.rows[0]?.max_version ?? 0;
  const newVersion = prevVersion + 1;

  // Mark all previous as non-current
  if (prevVersion > 0) {
    await client.query('UPDATE owner_profiles SET is_current = FALSE WHERE is_current = TRUE');
  }

  // Build change summary
  let changeSummary: string | null = null;
  if (prevVersion > 0) {
    changeSummary = `Version ${newVersion}: Re-imported from LinkedIn export. Previous version ${prevVersion} preserved.`;
  }

  // Insert new versioned profile
  const insertResult = await client.query<{ id: string }>(
    `INSERT INTO owner_profiles (
      version, is_current, source,
      first_name, last_name, headline, summary, industry, location, geo_location, zip_code,
      birth_date, email, phone, twitter_handles, websites, registered_at,
      ad_targeting, skills, certifications, honors, organizations, volunteering,
      projects, courses, events, positions, education, learning_courses,
      company_follows, saved_job_alerts,
      endorsements_given, endorsements_received,
      endorsements_given_count, endorsements_received_count,
      recommendations_given, recommendations_received,
      recommendations_given_count, recommendations_received_count,
      total_messages_sent, total_messages_received, total_conversations,
      invitations_sent, invitations_received,
      rich_media, receipts, imported_files, change_summary
    ) VALUES (
      $1, TRUE, 'linkedin_export',
      $2, $3, $4, $5, $6, $7, $8, $9,
      $10, $11, $12, $13, $14, $15,
      $16, $17, $18, $19, $20, $21,
      $22, $23, $24, $25, $26, $27,
      $28, $29,
      $30, $31,
      $32, $33,
      $34, $35,
      $36, $37,
      $38, $39, $40,
      $41, $42,
      $43, $44, $45, $46
    ) RETURNING id`,
    [
      newVersion,
      profile.firstName, profile.lastName, profile.headline, profile.summary,
      profile.industry, profile.location, profile.geoLocation, profile.zipCode,
      profile.birthDate, profile.email, profile.phone,
      profile.twitterHandles, profile.websites,
      profile.registeredAt ? new Date(profile.registeredAt) : null,
      JSON.stringify(profile.adTargeting),
      profile.skills,
      JSON.stringify(profile.certifications),
      JSON.stringify(profile.honors),
      JSON.stringify(profile.organizations),
      JSON.stringify(profile.volunteering),
      JSON.stringify(profile.projects),
      JSON.stringify(profile.courses),
      JSON.stringify(profile.events),
      JSON.stringify(profile.positions),
      JSON.stringify(profile.education),
      JSON.stringify(profile.learningCourses),
      profile.companyFollows,
      JSON.stringify(profile.savedJobAlerts),
      JSON.stringify(profile.endorsementsGiven),
      JSON.stringify(profile.endorsementsReceived),
      profile.endorsementsGiven.length,
      profile.endorsementsReceived.length,
      JSON.stringify(profile.recommendationsGiven),
      JSON.stringify(profile.recommendationsReceived),
      profile.recommendationsGiven.length,
      profile.recommendationsReceived.length,
      profile.totalMessagesSent,
      profile.totalMessagesReceived,
      profile.totalConversations,
      profile.invitationsSent,
      profile.invitationsReceived,
      JSON.stringify(profile.richMedia),
      JSON.stringify(profile.receipts),
      profile.importedFiles,
      changeSummary,
    ]
  );

  const selfName = [profile.firstName, profile.lastName].filter(Boolean).join(' ');

  return {
    profileId: insertResult.rows[0].id,
    version: newVersion,
    importedFiles: profile.importedFiles,
    skippedFiles,
    selfName,
  };
}
