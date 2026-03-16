// GET /api/extension/settings
// Returns extension settings for the authenticated extension

import { NextRequest, NextResponse } from 'next/server';
import { withExtensionAuth } from '@/lib/middleware/extension-auth-middleware';
import { query } from '@/lib/db/client';
import { DEFAULT_EXTENSION_SETTINGS } from '@/types/extension-auth';
import type { ExtensionSettings } from '@/types/extension-auth';

export async function GET(req: NextRequest) {
  return withExtensionAuth(req, async (_authReq, extensionId) => {
    try {
      // Try to load stored settings for this extension
      const result = await query<{ settings: ExtensionSettings }>(
        'SELECT settings FROM extension_settings WHERE extension_id = $1',
        [extensionId]
      );

      const settings =
        result.rows.length > 0
          ? { ...DEFAULT_EXTENSION_SETTINGS, ...result.rows[0].settings }
          : DEFAULT_EXTENSION_SETTINGS;

      return NextResponse.json({ settings });
    } catch (error) {
      console.error('[Settings] Error:', error);
      return NextResponse.json(
        { error: 'INTERNAL_ERROR', message: 'Failed to fetch settings' },
        { status: 500 }
      );
    }
  });
}
