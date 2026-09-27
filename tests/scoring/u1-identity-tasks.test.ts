jest.mock('@/lib/db/client', () => ({ query: jest.fn() }));
jest.mock('@/lib/contacts/task-schema', () => ({ requireIdentityTaskIndexes: jest.fn().mockResolvedValue(undefined) }));

import { query } from '@/lib/db/client';
import { contactDisplayName, hasLinkedIdentity } from '@/lib/contacts/identity';
import { checkAndGenerateTasks } from '@/lib/scoring/task-triggers';
import type { CompositeScore } from '@/lib/scoring/types';

const mockQuery = query as jest.MockedFunction<typeof query>;
const scored = {
  tier: 'gold', persona: 'buyer', referralPersona: 'warm-introducer',
  behavioralPersona: 'super-connector',
} as CompositeScore;

function rows(value: unknown[]) {
  return { rows: value, rowCount: value.length, command: '', oid: 0, fields: [] };
}

const contact = {
  full_name: '  Jane  Smith ', first_name: 'Jane', last_name: 'Smith',
  linkedin_url: 'https://www.linkedin.com/in/jane-smith/', degree: 1,
  is_archived: false,
};

describe('contact identity', () => {
  it('uses real given and family names when the imported full name is a placeholder', () => {
    expect(contactDisplayName({ fullName: 'Unknown', firstName: ' Ada ', lastName: ' Lovelace ' }))
      .toBe('Ada Lovelace');
    expect(contactDisplayName({ fullName: '  ', firstName: null, lastName: null })).toBeNull();
    expect(contactDisplayName({ fullName: ' \tUnknown Person\n', firstName: null, lastName: null })).toBeNull();
    expect(contactDisplayName({ fullName: '\tAda\nLovelace\r' })).toBe('Ada Lovelace');
  });

  it('requires a name and linked profile for outreach eligibility', () => {
    expect(hasLinkedIdentity({ fullName: 'Unknown', linkedinUrl: contact.linkedin_url })).toBe(false);
    expect(hasLinkedIdentity({ fullName: 'Unknown Person', linkedinUrl: contact.linkedin_url })).toBe(false);
    expect(hasLinkedIdentity({ fullName: 'Jane Smith', linkedinUrl: 'https://www.linkedin.com/in/unknown' })).toBe(false);
    expect(hasLinkedIdentity({ fullName: 'Jane Smith', linkedinUrl: 'https://www.linkedin.com/in/%75nknown' })).toBe(false);
    expect(hasLinkedIdentity({ fullName: 'Jane Smith', linkedinUrl: 'https://www.linkedin.com/in/jane%ZZ' })).toBe(false);
    expect(hasLinkedIdentity({ fullName: 'Jane Smith', linkedinUrl: 'https://www.linkedin.com/in/' })).toBe(false);
    expect(hasLinkedIdentity({ fullName: 'Jane Smith', linkedinUrl: 'self:c1' })).toBe(false);
    expect(hasLinkedIdentity({ fullName: 'Jane Smith', linkedinUrl: 'snippet-created://id' })).toBe(false);
    expect(hasLinkedIdentity({ fullName: 'Jane Smith', linkedinUrl: 'https://evil.test/in/jane' })).toBe(false);
    expect(hasLinkedIdentity({ fullName: 'Jane Smith', linkedinUrl: contact.linkedin_url })).toBe(true);
  });
});

describe('automatic score tasks', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockImplementation(async (sql) => {
      if (String(sql).includes('FROM contacts')) return rows([contact]) as never;
      return rows([]) as never;
    });
  });

  it('keeps known contact recommendations and links them to the contact', async () => {
    await checkAndGenerateTasks('c1', null, scored);
    const inserts = mockQuery.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO tasks'));
    expect(inserts).toHaveLength(4);
    expect(inserts.map(([, params]) => params?.[2])).toEqual(['SEND_MESSAGE', 'RESEARCH', 'SEND_MESSAGE', 'ENGAGE_CONTENT']);
    expect(inserts[0][1]).toEqual(expect.arrayContaining(['Send personalized intro to Jane Smith', '/contacts/c1']));
    expect(inserts.every(([sql]) => String(sql).includes('c.linkedin_url ~*'))).toBe(true);
  });

  it('suppresses score transitions for an incomparable predecessor while retaining identity repair', async () => {
    await checkAndGenerateTasks('c1', null, scored, true, { forceInline: true, identityOnly: true });
    expect(mockQuery.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO tasks'))).toHaveLength(0);

    mockQuery.mockReset();
    mockQuery.mockImplementation(async sql => {
      if (String(sql).includes('FROM contacts')) return rows([{
        ...contact, full_name: 'Unknown', first_name: null, last_name: null,
      }]) as never;
      return rows([]) as never;
    });
    await checkAndGenerateTasks('c2', null, scored, true, { forceInline: true, identityOnly: true });
    expect(mockQuery.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO tasks'))
      .map(([, params]) => params?.[2])).toEqual(['REPAIR_IDENTITY']);
  });

  it('creates only a linked identity repair for an unknown person', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (String(sql).includes('FROM contacts')) return rows([{ ...contact, full_name: 'Unknown', first_name: null, last_name: null }]) as never;
      return rows([]) as never;
    });
    await checkAndGenerateTasks('c2', null, scored);
    const inserts = mockQuery.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO tasks'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1]).toEqual(expect.arrayContaining(['Verify identity for contact', 'REPAIR_IDENTITY', '/contacts/c2']));
    expect(String(inserts[0][0])).toContain('ON CONFLICT (contact_id)');
    expect(String(inserts[0][0])).toContain('NOT COALESCE');
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('SELECT id FROM tasks'))).toBe(false);
  });

  it('treats a named contact without a real profile as identity deficient', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (String(sql).includes('FROM contacts')) return rows([{ ...contact, linkedin_url: 'snippet-created://id' }]) as never;
      return rows([]) as never;
    });
    await checkAndGenerateTasks('c3', null, scored);
    const inserts = mockQuery.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO tasks'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1]?.[2]).toBe('REPAIR_IDENTITY');
  });

  it('never creates outreach or repair tasks for the owner', async () => {
    mockQuery.mockResolvedValueOnce(rows([{ ...contact, degree: 0 }]) as never);
    await checkAndGenerateTasks('self', null, scored);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('recognizes the importer self marker even when degree defaults to one', async () => {
    mockQuery.mockResolvedValueOnce(rows([{ ...contact, linkedin_url: 'self:c1', degree: 1 }]) as never);
    await checkAndGenerateTasks('self', null, scored);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
