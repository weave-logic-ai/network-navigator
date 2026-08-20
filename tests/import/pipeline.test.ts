import { detectFileType, PROCESSING_ORDER } from '@/lib/import/pipeline';

// --- Mocks for runImportPipeline's full dependency graph ---
// (detectFileType/PROCESSING_ORDER above need none of this; only the
// runImportPipeline suite below, which exercises the Natural ICP trigger,
// needs the pipeline's collaborators mocked out.)

jest.mock('fs/promises', () => ({
  readFile: jest.fn().mockResolvedValue(''),
  stat: jest.fn().mockResolvedValue({ size: 10 }),
}));

jest.mock('@/lib/import/connections-importer', () => ({
  importConnections: jest.fn().mockResolvedValue({
    totalRows: 0,
    newRecords: 0,
    skippedRecords: 0,
    errors: [],
  }),
}));
jest.mock('@/lib/import/messages-importer', () => ({
  importMessages: jest.fn().mockResolvedValue({
    totalRows: 0,
    newRecords: 0,
    skippedRecords: 0,
    errors: [],
  }),
}));
jest.mock('@/lib/import/relationships-importer', () => ({
  importInvitations: jest.fn().mockResolvedValue({
    totalRows: 0,
    newRecords: 0,
    skippedRecords: 0,
    errors: [],
  }),
  importEndorsements: jest.fn().mockResolvedValue({
    totalRows: 0,
    newRecords: 0,
    skippedRecords: 0,
    errors: [],
  }),
  importRecommendations: jest.fn().mockResolvedValue({
    totalRows: 0,
    newRecords: 0,
    skippedRecords: 0,
    errors: [],
  }),
}));
jest.mock('@/lib/import/positions-importer', () => ({
  importPositions: jest.fn().mockResolvedValue({
    totalRows: 0,
    newRecords: 0,
    skippedRecords: 0,
    errors: [],
  }),
}));
jest.mock('@/lib/import/education-importer', () => ({
  importEducation: jest.fn().mockResolvedValue({
    totalRows: 0,
    newRecords: 0,
    skippedRecords: 0,
    errors: [],
  }),
}));
jest.mock('@/lib/import/skills-importer', () => ({
  importSkills: jest.fn().mockResolvedValue({
    totalRows: 0,
    newRecords: 0,
    skippedRecords: 0,
    errors: [],
  }),
}));
jest.mock('@/lib/import/company-follows-importer', () => ({
  importCompanyFollows: jest.fn().mockResolvedValue({
    totalRows: 0,
    newRecords: 0,
    skippedRecords: 0,
    errors: [],
  }),
}));
jest.mock('@/lib/import/embedding-generator', () => ({
  generateEmbeddings: jest.fn().mockResolvedValue({ generated: 0, skipped: 0, errors: 0 }),
}));
jest.mock('@/lib/taxonomy/seed', () => ({
  seedTaxonomyIfEmpty: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/import/import-session', () => ({
  createImportSession: jest.fn().mockResolvedValue('session-1'),
  updateSessionProgress: jest.fn().mockResolvedValue(undefined),
  completeSession: jest.fn().mockResolvedValue(undefined),
  createImportFileRecord: jest.fn().mockResolvedValue('file-1'),
  updateImportFileRecord: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/scoring/natural-icp', () => ({
  computeNaturalICP: jest.fn(),
}));

describe('Import Pipeline', () => {
  describe('detectFileType', () => {
    it('should detect Connections.csv', () => {
      expect(detectFileType('Connections.csv')).toBe('connections');
    });

    it('should detect messages.csv', () => {
      expect(detectFileType('messages.csv')).toBe('messages');
    });

    it('should detect Invitations.csv', () => {
      expect(detectFileType('Invitations.csv')).toBe('invitations');
    });

    it('should detect Endorsements Received.csv', () => {
      expect(detectFileType('Endorsements Received.csv')).toBe('endorsements');
    });

    it('should detect Recommendations Given.csv', () => {
      expect(detectFileType('Recommendations Given.csv')).toBe('recommendations');
    });

    it('should detect Positions.csv', () => {
      expect(detectFileType('Positions.csv')).toBe('positions');
    });

    it('should detect Education.csv', () => {
      expect(detectFileType('Education.csv')).toBe('education');
    });

    it('should detect Skills.csv', () => {
      expect(detectFileType('Skills.csv')).toBe('skills');
    });

    it('should detect Company Follows.csv', () => {
      expect(detectFileType('Company Follows.csv')).toBe('company_follows');
    });

    it('should detect Profile.csv', () => {
      expect(detectFileType('Profile.csv')).toBe('profile');
    });

    it('should return null for unknown files', () => {
      expect(detectFileType('unknown.csv')).toBe(null);
    });

    it('should be case insensitive', () => {
      expect(detectFileType('CONNECTIONS.csv')).toBe('connections');
      expect(detectFileType('Messages.CSV')).toBe('messages');
    });
  });

  describe('PROCESSING_ORDER', () => {
    it('should process profile first', () => {
      expect(PROCESSING_ORDER[0]).toBe('profile');
    });

    it('should process connections before other contact-dependent files', () => {
      const connectionsIdx = PROCESSING_ORDER.indexOf('connections');
      const messagesIdx = PROCESSING_ORDER.indexOf('messages');
      const positionsIdx = PROCESSING_ORDER.indexOf('positions');
      const educationIdx = PROCESSING_ORDER.indexOf('education');
      const skillsIdx = PROCESSING_ORDER.indexOf('skills');

      expect(connectionsIdx).toBeLessThan(messagesIdx);
      expect(connectionsIdx).toBeLessThan(positionsIdx);
      expect(connectionsIdx).toBeLessThan(educationIdx);
      expect(connectionsIdx).toBeLessThan(skillsIdx);
    });

    it('should process company_follows last', () => {
      expect(PROCESSING_ORDER[PROCESSING_ORDER.length - 1]).toBe('company_follows');
    });

    it('should include all 10 file types', () => {
      expect(PROCESSING_ORDER.length).toBe(10);
    });
  });

  describe('runImportPipeline — Natural ICP trigger', () => {
    // docs/plans/icp-alignment-engine.md specifies the Natural ICP "runs
    // automatically during import". This covers where it's wired in
    // (pipeline.ts, once per import, not per file/contact) and that it
    // cannot fail the import even if computeNaturalICP() rejects.
    function fakeClient() {
      return {
        query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      } as unknown as import('pg').PoolClient;
    }

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('calls computeNaturalICP exactly once per import, not per file or per contact', async () => {
      const { runImportPipeline } = await import('@/lib/import/pipeline');
      const { computeNaturalICP } = await import('@/lib/scoring/natural-icp');
      (computeNaturalICP as jest.Mock).mockResolvedValue(null);

      await runImportPipeline(
        fakeClient(),
        ['/tmp/Connections.csv', '/tmp/Positions.csv', '/tmp/Education.csv'],
        'self-1',
        'Self Name'
      );

      expect(computeNaturalICP).toHaveBeenCalledTimes(1);
    });

    it('does not fail the import when computeNaturalICP rejects', async () => {
      const { runImportPipeline } = await import('@/lib/import/pipeline');
      const { computeNaturalICP } = await import('@/lib/scoring/natural-icp');
      (computeNaturalICP as jest.Mock).mockRejectedValue(new Error('ICP computation exploded'));

      const summary = await runImportPipeline(
        fakeClient(),
        ['/tmp/Connections.csv'],
        'self-1',
        'Self Name'
      );

      expect(summary.status).toBe('completed');
      expect(
        summary.errors.some((e) => e.message.includes('ICP computation exploded'))
      ).toBe(false);
    });

    it('does not await computeNaturalICP before resolving (fire-and-forget)', async () => {
      const { runImportPipeline } = await import('@/lib/import/pipeline');
      const { computeNaturalICP } = await import('@/lib/scoring/natural-icp');
      let resolveIcp: () => void = () => {};
      (computeNaturalICP as jest.Mock).mockReturnValue(
        new Promise<null>((resolve) => {
          resolveIcp = () => resolve(null);
        })
      );

      const summary = await runImportPipeline(
        fakeClient(),
        ['/tmp/Connections.csv'],
        'self-1',
        'Self Name'
      );

      // The pipeline resolved even though the computeNaturalICP promise is
      // still pending -- it was not awaited.
      expect(summary.status).toBe('completed');
      expect(computeNaturalICP).toHaveBeenCalledTimes(1);
      resolveIcp();
    });
  });
});
