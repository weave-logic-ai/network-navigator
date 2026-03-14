import { detectFileType, PROCESSING_ORDER } from '@/lib/import/pipeline';

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
});
