import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

test.use({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3750' });

interface RegressionReport {
  captureId: string;
  extracted: {
    success: boolean;
    fieldsExtracted: number;
    fieldsAttempted: number;
    fields: Array<{ field: string; value: unknown; confidence: number }>;
    data: { profileImageUrl: string | null; connectionsCount: number | null };
  };
  unmatched: Array<{ domPath: string; textPreview: string; byteLength: number }>;
  telemetryRecorded: boolean;
  telemetry: {
    attempted: boolean;
    rowsWritten: number;
    reason: string | null;
    flagEnabled: boolean;
  };
}

test('US-3: profile fixture exposes extracted fields and an unexplained DOM block', async ({ request }) => {
  test.info().annotations.push({
    type: 'known-gap',
    description: 'This endpoint parses HTML and reports best-effort telemetry; it does not create a reviewed fixture, a GitHub issue, or a 24-hour miss-rate alert.',
  });

  const fixture = readFileSync(
    path.resolve(__dirname, '../../../data/parser-fixtures/profile/01-basic.html'),
    'utf8'
  );
  const unexplainedText =
    'Unmapped profile panel: this newly added region contains substantial text that the current profile selectors do not extract or classify.';
  const rawHtml = fixture.replace(
    '</main>',
    `<section class="unmapped-profile-panel"><p>${unexplainedText}</p></section></main>`
  );
  expect(rawHtml).not.toBe(fixture);

  const captureId = `us3-parser-regression-${randomUUID()}`;
  const response = await request.post('/api/parser/regression-report', {
    data: {
      pageType: 'PROFILE',
      rawHtml,
      captureId,
      url: 'https://www.linkedin.com/in/redacted-abc123/',
    },
  });
  expect(response.status(), await response.text()).toBe(200);
  const report = (await response.json()) as RegressionReport;

  expect(report.captureId).toBe(captureId);
  expect(report.extracted.success).toBe(true);
  expect(report.extracted.fieldsExtracted).toBeGreaterThan(0);
  expect(report.extracted.fieldsAttempted).toBeGreaterThanOrEqual(report.extracted.fieldsExtracted);
  expect(report.extracted.fields).toEqual(expect.arrayContaining([
    expect.objectContaining({ field: 'name', value: expect.stringContaining('Redacted Name') }),
    expect.objectContaining({ field: 'profileImageUrl', value: 'https://example.invalid/placeholder.png' }),
    expect.objectContaining({ field: 'connectionsCount', value: 482 }),
  ]));
  expect(report.extracted.data.profileImageUrl).toBe('https://example.invalid/placeholder.png');
  expect(report.extracted.data.connectionsCount).toBe(482);

  expect(report.unmatched).toEqual(expect.arrayContaining([
    expect.objectContaining({
      domPath: expect.stringContaining('section.unmapped-profile-panel'),
      textPreview: expect.stringContaining(unexplainedText),
      byteLength: expect.any(Number),
    }),
  ]));
  expect(report.extracted.fields.some((field) => field.value === unexplainedText)).toBe(false);

  // Telemetry is flag-gated and its DB write is best-effort; the response must
  // truthfully distinguish a write from a skipped or failed attempt.
  expect(report.telemetryRecorded).toBe(report.telemetry.rowsWritten > 0);
  if (!report.telemetry.flagEnabled) {
    expect(report.telemetry).toMatchObject({ attempted: false, rowsWritten: 0, reason: 'flag-off' });
  } else {
    expect(report.telemetry.attempted).toBe(true);
    if (report.telemetryRecorded) {
      expect(report.telemetry.rowsWritten).toBe(report.extracted.fields.length);
      expect(report.telemetry.reason).toBeNull();
    } else {
      expect(report.telemetry).toMatchObject({ rowsWritten: 0, reason: 'db-error' });
    }
  }
});
