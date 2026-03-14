// POST /api/import/upload - accept multipart CSV file upload

import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { createImportSession } from '@/lib/db/queries/import';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const UPLOAD_DIR = join(process.cwd(), 'uploads', 'imports');

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('files');

    if (!files || files.length === 0) {
      return NextResponse.json(
        { error: 'No files provided. Use "files" field for multipart upload.' },
        { status: 400 }
      );
    }

    const validFiles: { name: string; path: string }[] = [];
    const errors: string[] = [];

    // Create session
    const sessionId = await createImportSession();

    // Create upload directory for this session
    const sessionDir = join(UPLOAD_DIR, sessionId);
    await mkdir(sessionDir, { recursive: true });

    for (const file of files) {
      if (!(file instanceof File)) {
        errors.push('Invalid file entry');
        continue;
      }

      // Validate file type
      if (!file.name.toLowerCase().endsWith('.csv')) {
        errors.push(`${file.name}: only .csv files are accepted`);
        continue;
      }

      // Validate file size
      if (file.size > MAX_FILE_SIZE) {
        errors.push(`${file.name}: file exceeds 50 MB limit`);
        continue;
      }

      // Save file
      const buffer = Buffer.from(await file.arrayBuffer());
      const filePath = join(sessionDir, file.name);
      await writeFile(filePath, buffer);

      validFiles.push({ name: file.name, path: filePath });
    }

    if (validFiles.length === 0) {
      return NextResponse.json(
        { error: 'No valid CSV files uploaded', details: errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        sessionId,
        files: validFiles.map((f) => f.name),
        uploadDir: sessionDir,
        errors: errors.length > 0 ? errors : undefined,
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: 'Upload failed', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
