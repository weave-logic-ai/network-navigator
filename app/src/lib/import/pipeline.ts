// Import pipeline: ordered multi-CSV processing (10-file dependency order)

import { readFile, stat } from 'fs/promises';
import { basename } from 'path';
import { PoolClient } from 'pg';
import { ImportFileType, ImportSummary, ImportError } from './types';
import {
  createImportSession,
  updateSessionProgress,
  completeSession,
  createImportFileRecord,
  updateImportFileRecord,
} from './import-session';
import { importConnections } from './connections-importer';
import { importMessages } from './messages-importer';
import { importInvitations, importEndorsements, importRecommendations } from './relationships-importer';
import { importPositions } from './positions-importer';
import { importEducation } from './education-importer';
import { importSkills } from './skills-importer';
import { importCompanyFollows } from './company-follows-importer';
import { generateEmbeddings } from './embedding-generator';

// File type detection from filename
function detectFileType(filename: string): ImportFileType | null {
  const lower = filename.toLowerCase();
  if (lower.includes('connection')) return 'connections';
  if (lower.includes('message')) return 'messages';
  if (lower.includes('invitation')) return 'invitations';
  if (lower.includes('endorsement')) return 'endorsements';
  if (lower.includes('recommendation')) return 'recommendations';
  if (lower.includes('position')) return 'positions';
  if (lower.includes('education')) return 'education';
  if (lower.includes('skill')) return 'skills';
  if (lower.includes('company') && lower.includes('follow')) return 'company_follows';
  if (lower.includes('profile')) return 'profile';
  return null;
}

// Processing order for dependency resolution
const PROCESSING_ORDER: ImportFileType[] = [
  'profile',
  'connections',
  'positions',
  'education',
  'skills',
  'endorsements',
  'recommendations',
  'invitations',
  'messages',
  'company_follows',
];

interface FileInfo {
  path: string;
  filename: string;
  fileType: ImportFileType;
  sizeBytes: number;
}

export async function runImportPipeline(
  client: PoolClient,
  filePaths: string[],
  selfContactId: string,
  selfName: string = '',
  existingSessionId?: string
): Promise<ImportSummary> {
  const startTime = Date.now();
  const allErrors: ImportError[] = [];
  let totalRecords = 0;
  let newRecords = 0;
  let updatedRecords = 0;
  let skippedRecords = 0;

  // Detect file types and gather file info
  const files: FileInfo[] = [];
  for (const filePath of filePaths) {
    const filename = basename(filePath);
    const fileType = detectFileType(filename);
    if (!fileType) continue;

    try {
      const fileStat = await stat(filePath);
      files.push({
        path: filePath,
        filename,
        fileType,
        sizeBytes: fileStat.size,
      });
    } catch {
      allErrors.push({ file: filename, message: 'File not found or unreadable' });
    }
  }

  // Use existing session if provided, otherwise create one
  const sessionId = existingSessionId || await createImportSession(client, files.length);
  if (existingSessionId) {
    await updateSessionProgress(client, sessionId, { processedFiles: 0 });
  }

  // Ensure the self-contact exists so edge FK constraints are satisfied
  await client.query(
    `INSERT INTO contacts (id, first_name, last_name, source)
     VALUES ($1, $2, '', 'self')
     ON CONFLICT (id) DO NOTHING`,
    [selfContactId, selfName || 'Me']
  );

  // Sort files by processing order
  const sortedFiles = files.sort(
    (a, b) => PROCESSING_ORDER.indexOf(a.fileType) - PROCESSING_ORDER.indexOf(b.fileType)
  );

  let processedCount = 0;

  for (const file of sortedFiles) {
    const fileRecordId = await createImportFileRecord(
      client,
      sessionId,
      file.filename,
      file.fileType,
      file.sizeBytes
    );

    try {
      const content = await readFile(file.path, 'utf-8');

      let fileResult: { totalRows: number; newRecords: number; updatedRecords?: number; skippedRecords: number; errors: ImportError[] };

      switch (file.fileType) {
        case 'connections':
          fileResult = await importConnections(client, content, sessionId, selfContactId);
          break;
        case 'messages':
          fileResult = await importMessages(client, content, sessionId, selfContactId, selfName);
          break;
        case 'invitations':
          fileResult = await importInvitations(client, content, selfContactId);
          break;
        case 'endorsements':
          fileResult = await importEndorsements(client, content, selfContactId, true);
          break;
        case 'recommendations':
          fileResult = await importRecommendations(client, content, selfContactId, true);
          break;
        case 'positions':
          fileResult = await importPositions(client, content, selfContactId);
          break;
        case 'education':
          fileResult = await importEducation(client, content, selfContactId);
          break;
        case 'skills':
          fileResult = await importSkills(client, content, selfContactId);
          break;
        case 'company_follows':
          fileResult = await importCompanyFollows(client, content, selfContactId);
          break;
        case 'profile':
          // Profile.csv is the user's own profile -- skip for now (no special handler)
          fileResult = { totalRows: 0, newRecords: 0, skippedRecords: 0, errors: [] };
          break;
        default:
          fileResult = { totalRows: 0, newRecords: 0, skippedRecords: 0, errors: [] };
      }

      totalRecords += fileResult.totalRows;
      newRecords += fileResult.newRecords;
      updatedRecords += fileResult.updatedRecords ?? 0;
      skippedRecords += fileResult.skippedRecords;
      allErrors.push(...fileResult.errors);

      await updateImportFileRecord(client, fileRecordId, {
        recordCount: fileResult.totalRows,
        processedCount: fileResult.newRecords + (fileResult.updatedRecords ?? 0) + fileResult.skippedRecords,
        status: fileResult.errors.length > 0 ? 'completed_with_errors' : 'completed',
        errors: fileResult.errors,
      });
    } catch (err) {
      allErrors.push({
        file: file.filename,
        message: err instanceof Error ? err.message : 'Processing failed',
      });
      await updateImportFileRecord(client, fileRecordId, {
        status: 'failed',
        errors: [{ message: err instanceof Error ? err.message : 'Processing failed' }],
      });
    }

    processedCount++;
    await updateSessionProgress(client, sessionId, {
      processedFiles: processedCount,
      totalRecords,
      newRecords,
      updatedRecords,
      skippedRecords,
      errorCount: allErrors.length,
    });
  }

  // Post-import: generate embeddings
  try {
    await generateEmbeddings(client);
  } catch {
    allErrors.push({ message: 'Embedding generation failed (non-critical)' });
  }

  // Complete session
  const finalStatus = allErrors.length > 0 && newRecords === 0 ? 'failed' : 'completed';
  await completeSession(client, sessionId, finalStatus, allErrors);

  return {
    sessionId,
    status: finalStatus,
    totalFiles: files.length,
    processedFiles: processedCount,
    totalRecords,
    newRecords,
    updatedRecords,
    skippedRecords,
    errorCount: allErrors.length,
    errors: allErrors,
    duration: Date.now() - startTime,
  };
}

// Export for testing
export { detectFileType, PROCESSING_ORDER };
