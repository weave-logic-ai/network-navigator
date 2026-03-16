// Zod validation schemas for capture endpoint

import { z } from 'zod';

export const captureRequestSchema = z.object({
  captureId: z.string().uuid(),
  url: z.string().url().refine((url) => url.includes('linkedin.com'), {
    message: 'URL must be a LinkedIn URL',
  }),
  pageType: z.enum([
    'PROFILE',
    'PROFILE_ACTIVITY',
    'SEARCH_PEOPLE',
    'SEARCH_CONTENT',
    'FEED',
    'COMPANY',
    'CONNECTIONS',
    'MESSAGES',
    'OTHER',
  ]),
  html: z.string().min(100).max(10_000_000), // 10MB max raw HTML
  scrollDepth: z.number().min(0).max(1),
  viewportHeight: z.number().int().positive(),
  documentHeight: z.number().int().positive(),
  capturedAt: z.string(),
  extensionVersion: z.string(),
  sessionId: z.string(),
  triggerMode: z.enum(['manual', 'auto']),
});

export type CaptureRequestBody = z.infer<typeof captureRequestSchema>;

export interface CaptureResponse {
  success: boolean;
  captureId: string;
  storedBytes: number;
  compressionRatio: number;
  queuedForParsing: boolean;
  pageType: string;
}
