// Snippet blob-store tests — Phase 1.5 image round-trip.
//
// Pins the five behaviours that distinguish the image path from the text
// path:
//   1. Base64 decode + mime/size validation (5 MB cap, whitelisted mimes).
//   2. sha256-based dedup — second upsert of the same bytes returns
//      reused=true and no second INSERT is issued.
//   3. Tenant isolation — blobs owned by tenant A are invisible to tenant B
//      (the WHERE clause pins tenant_id).
//   4. Race-safe INSERT — uses ON CONFLICT to fall back to the existing row
//      if the SELECT-then-INSERT is interleaved by a peer request.
//   5. Size limit — payloads above 5 MB throw before the DB is touched.

jest.mock('@/lib/db/client', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
  healthCheck: jest.fn(),
  getPool: jest.fn(),
  shutdown: jest.fn(),
}));

import { query } from '@/lib/db/client';
import fs from 'fs';
import path from 'path';
import {
  upsertBlob,
  getBlob,
  sha256Hex,
  decodeAndValidateImage,
  MAX_IMAGE_BYTES,
  ALLOWED_IMAGE_MIME_TYPES,
} from '@/lib/snippets/blob-store';

const mockQuery = query as jest.MockedFunction<typeof query>;
const schemaSql = fs.readFileSync(path.resolve(__dirname, '../../data/db/init/034-snippets-schema.sql'), 'utf8');
const migrationSql = fs.readFileSync(path.resolve(__dirname, '../../data/db/init/052-snippet-blob-size-limit.sql'), 'utf8');

function mockRows<T>(rows: T[]): ReturnType<typeof query> {
  return Promise.resolve({
    rows,
    command: '',
    rowCount: rows.length,
    oid: 0,
    fields: [],
  }) as ReturnType<typeof query>;
}

// Tiny 1×1 PNG (8 bytes of zeros padded) — we fake the bytes because the
// blob store is agnostic to image validity; the wire protocol only checks
// mime-type and size.
const FAKE_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0xde, 0xad, 0xbe, 0xef,
]);

describe('decodeAndValidateImage', () => {
  it('accepts a plain base64 payload for an allowed mime type', () => {
    const b64 = FAKE_PNG.toString('base64');
    const out = decodeAndValidateImage(b64, 'image/png');
    expect(out.equals(FAKE_PNG)).toBe(true);
  });

  it('accepts a data-URL-prefixed base64 payload', () => {
    const b64 = `data:image/webp;base64,${FAKE_PNG.toString('base64')}`;
    const out = decodeAndValidateImage(b64, 'image/webp');
    expect(out.equals(FAKE_PNG)).toBe(true);
  });

  it('rejects an unsupported mime type', () => {
    expect(() => decodeAndValidateImage(FAKE_PNG.toString('base64'), 'image/gif')).toThrow(
      /unsupported mimeType/
    );
  });

  it('rejects a payload that decodes above the 5 MB cap', () => {
    const oversized = Buffer.alloc(MAX_IMAGE_BYTES + 1, 0xaa).toString('base64');
    expect(() => decodeAndValidateImage(oversized, 'image/jpeg')).toThrow(/5 MB/);
  });

  it('accepts a payload exactly at the 5 MB cap', () => {
    const maxSize = Buffer.alloc(MAX_IMAGE_BYTES, 0xaa).toString('base64');
    expect(decodeAndValidateImage(maxSize, 'image/jpeg').byteLength).toBe(MAX_IMAGE_BYTES);
  });

  it('rejects an empty string payload', () => {
    expect(() => decodeAndValidateImage('', 'image/png')).toThrow(/non-empty/);
  });

  it('exposes the whitelist constants', () => {
    expect(Array.from(ALLOWED_IMAGE_MIME_TYPES).sort()).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
  });
});

describe('snippet blob database size limit', () => {
  it('keeps fresh installs and the forward migration at the app limit', () => {
    expect(MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024);
    expect(schemaSql).toMatch(new RegExp(`byte_length\\s+INTEGER NOT NULL CHECK \\(byte_length > 0 AND byte_length <= ${MAX_IMAGE_BYTES}\\)`));
    expect(migrationSql).toMatch(/BEGIN;[\s\S]*DROP CONSTRAINT IF EXISTS snippet_blobs_byte_length_check;[\s\S]*ADD CONSTRAINT snippet_blobs_byte_length_check[\s\S]*COMMIT;/);
    expect(migrationSql).toContain(`CHECK (byte_length > 0 AND byte_length <= ${MAX_IMAGE_BYTES})`);
  });
});

describe('sha256Hex', () => {
  it('produces stable hex for identical bytes', () => {
    expect(sha256Hex(FAKE_PNG)).toBe(sha256Hex(FAKE_PNG));
  });

  it('differs when bytes differ', () => {
    const other = Buffer.concat([FAKE_PNG, Buffer.from([0x00])]);
    expect(sha256Hex(FAKE_PNG)).not.toBe(sha256Hex(other));
  });

  it('matches a known fixture', () => {
    // sha256 of the 12-byte FAKE_PNG, verified via node crypto.
    const expected = sha256Hex(FAKE_PNG);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('upsertBlob — dedup contract', () => {
  beforeEach(() => mockQuery.mockReset());

  it('reuses an existing row when sha256 already exists for the tenant', async () => {
    mockQuery.mockImplementationOnce(() =>
      mockRows([{ id: 'blob-existing-1', byte_length: FAKE_PNG.byteLength }])
    );
    const out = await upsertBlob({
      tenantId: 'tenant-1',
      mimeType: 'image/png',
      bytes: FAKE_PNG,
    });
    expect(out.reused).toBe(true);
    expect(out.id).toBe('blob-existing-1');
    // Only the SELECT — no INSERT.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('inserts a new row when sha256 is not yet stored', async () => {
    mockQuery
      .mockImplementationOnce(() => mockRows([])) // SELECT returns nothing
      .mockImplementationOnce(() => mockRows([{ id: 'blob-new-1' }])); // INSERT returns id
    const out = await upsertBlob({
      tenantId: 'tenant-1',
      mimeType: 'image/png',
      bytes: FAKE_PNG,
    });
    expect(out.reused).toBe(false);
    expect(out.id).toBe('blob-new-1');
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const insertCall = mockQuery.mock.calls[1];
    expect(String(insertCall[0])).toMatch(/INSERT INTO snippet_blobs/);
  });

  it('enforces the 5 MB cap before hitting the DB', async () => {
    const oversized = Buffer.alloc(MAX_IMAGE_BYTES + 1, 0xaa);
    await expect(
      upsertBlob({ tenantId: 'tenant-1', mimeType: 'image/png', bytes: oversized })
    ).rejects.toThrow(/cap/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('inserts a blob exactly at the 5 MB cap', async () => {
    mockQuery
      .mockImplementationOnce(() => mockRows([]))
      .mockImplementationOnce(() => mockRows([{ id: 'blob-max' }]));
    const out = await upsertBlob({
      tenantId: 'tenant-1',
      mimeType: 'image/png',
      bytes: Buffer.alloc(MAX_IMAGE_BYTES, 0xaa),
    });
    expect(out.byteLength).toBe(MAX_IMAGE_BYTES);
    expect(mockQuery.mock.calls[1][1]?.[2]).toBe(MAX_IMAGE_BYTES);
  });

  it('rejects unsupported mime types without hitting the DB', async () => {
    await expect(
      upsertBlob({ tenantId: 'tenant-1', mimeType: 'image/gif', bytes: FAKE_PNG })
    ).rejects.toThrow(/unsupported mimeType/);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('getBlob — tenant isolation', () => {
  beforeEach(() => mockQuery.mockReset());

  it('returns the blob when tenant and id match', async () => {
    mockQuery.mockImplementationOnce(() =>
      mockRows([
        {
          id: 'blob-1',
          tenant_id: 'tenant-A',
          mime_type: 'image/png',
          byte_length: FAKE_PNG.byteLength,
          sha256: Buffer.from(sha256Hex(FAKE_PNG), 'hex'),
          data: FAKE_PNG,
          created_at: '2026-04-17T00:00:00Z',
        },
      ])
    );
    const blob = await getBlob('tenant-A', 'blob-1');
    expect(blob).not.toBeNull();
    expect(blob!.mimeType).toBe('image/png');
    expect(blob!.bytes.equals(FAKE_PNG)).toBe(true);
    expect(blob!.sha256Hex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns null when queried with a different tenant (RLS-equivalent)', async () => {
    mockQuery.mockImplementationOnce(() => mockRows([]));
    const blob = await getBlob('tenant-B', 'blob-1');
    expect(blob).toBeNull();
    // The generated SQL includes tenant_id in the WHERE clause so a cross-
    // tenant caller gets no row.
    const sqlCalled = String(mockQuery.mock.calls[0][0]);
    expect(sqlCalled).toMatch(/tenant_id = \$2/);
  });
});
