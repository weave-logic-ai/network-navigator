// Import domain TypeScript interfaces

export interface CsvParseOptions {
  delimiter?: string;
  preambleLines?: number;
  stripBom?: boolean;
}

export interface CsvParseResult {
  rows: Record<string, string>[];
  rowCount: number;
  errorCount: number;
  errors: CsvParseError[];
  headers: string[];
}

export interface CsvParseError {
  row: number;
  message: string;
  raw?: string;
}

export type ImportFileType =
  | 'connections'
  | 'messages'
  | 'invitations'
  | 'endorsements'
  | 'recommendations'
  | 'positions'
  | 'education'
  | 'skills'
  | 'company_follows'
  | 'profile';

export interface ImportFile {
  path: string;
  filename: string;
  fileType: ImportFileType;
  fileSizeBytes: number;
}

export interface ImportSessionRecord {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  totalFiles: number;
  processedFiles: number;
  totalRecords: number;
  newRecords: number;
  updatedRecords: number;
  skippedRecords: number;
  errorCount: number;
  errors: ImportError[];
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

export interface ImportError {
  file?: string;
  row?: number;
  message: string;
  details?: unknown;
}

export interface ImportFileRecord {
  id: string;
  sessionId: string;
  filename: string;
  fileType: ImportFileType;
  fileSizeBytes: number | null;
  recordCount: number;
  processedCount: number;
  status: string;
  errors: ImportError[];
  createdAt: Date;
}

export interface FieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export type DedupAction = 'created' | 'updated' | 'skipped';

export interface DedupResult {
  action: DedupAction;
  contactId: string;
  changes: FieldChange[];
  isJobChange: boolean;
}

export interface CompanyRecord {
  id: string;
  name: string;
  slug: string;
  domain?: string;
  industry?: string;
  sizeRange?: string;
  linkedinUrl?: string;
}

export interface ContactRecord {
  id: string;
  linkedinUrl: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  headline?: string;
  title?: string;
  currentCompany?: string;
  currentCompanyId?: string;
  location?: string;
  about?: string;
  email?: string;
  phone?: string;
  connectionsCount?: number;
  degree?: number;
  tags?: string[];
  dedupHash?: string;
}

export interface EdgeRecord {
  sourceContactId: string;
  targetContactId?: string;
  targetCompanyId?: string;
  edgeType: EdgeType;
  weight?: number;
  properties?: Record<string, unknown>;
}

export type EdgeType =
  | 'CONNECTED_TO'
  | 'MESSAGED'
  | 'ENDORSED'
  | 'RECOMMENDED'
  | 'INVITED_BY'
  | 'WORKS_AT'
  | 'WORKED_AT'
  | 'EDUCATED_AT'
  | 'FOLLOWS_COMPANY';

export interface ImportSummary {
  sessionId: string;
  status: 'completed' | 'failed';
  totalFiles: number;
  processedFiles: number;
  totalRecords: number;
  newRecords: number;
  updatedRecords: number;
  skippedRecords: number;
  errorCount: number;
  errors: ImportError[];
  duration: number;
}

export interface MessageRecord {
  contactId: string;
  direction: 'sent' | 'received';
  subject?: string;
  content: string;
  conversationId?: string;
  sentAt: Date;
}

export interface MessageStatsRecord {
  contactId: string;
  totalMessages: number;
  sentCount: number;
  receivedCount: number;
  firstMessageAt: Date;
  lastMessageAt: Date;
  avgResponseTimeHours?: number;
  conversationCount: number;
}

export interface WorkHistoryRecord {
  contactId: string;
  companyId?: string;
  companyName: string;
  title: string;
  startDate?: Date;
  endDate?: Date;
  isCurrent: boolean;
  description?: string;
}

export interface EducationRecord {
  contactId: string;
  institution: string;
  degree?: string;
  fieldOfStudy?: string;
  startDate?: Date;
  endDate?: Date;
}
