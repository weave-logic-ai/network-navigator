// Parser engine types
// Defines interfaces for the LinkedIn page parsing system

import type { CheerioAPI } from 'cheerio';
import type {
  SelectorConfig,
  LinkedInPageType,
} from '@/types/selector-config';

/** Result of extracting a single field */
export interface ExtractedField {
  field: string;
  value: string | string[] | number | null;
  confidence: number; // 0.0 - 1.0
  selectorUsed: string; // Which selector in the chain matched
  selectorIndex?: number; // Position in the chain (0 = first/best)
  source: 'selector' | 'heuristic' | 'content-heuristic' | 'title-tag' | 'url-slug';
}

/** Profile-specific parsed data */
export interface ProfileParseData {
  name: string | null;
  headline: string | null;
  location: string | null;
  about: string | null;
  connectionsCount: number | null;
  experience: ExperienceEntry[];
  education: EducationEntry[];
  skills: string[];
  profileImageUrl: string | null;
}

export interface ExperienceEntry {
  company: string;
  title: string;
  duration: string | null;
  startDate: string | null;
  endDate: string | null;
  location: string | null;
  description: string | null;
  isCurrent: boolean;
}

export interface EducationEntry {
  school: string;
  degree: string | null;
  fieldOfStudy: string | null;
  startYear: number | null;
  endYear: number | null;
}

/** Search results parsed data */
export interface SearchParseData {
  results: SearchResultEntry[];
  totalResultsEstimate: number | null;
  currentPage: number | null;
}

export interface SearchResultEntry {
  name: string;
  headline: string | null;
  profileUrl: string;
  location: string | null;
  connectionDegree: string | null;
  mutualConnections: number | null;
}

/** Feed/activity parsed data */
export interface FeedParseData {
  posts: FeedPostEntry[];
}

export interface FeedPostEntry {
  authorName: string;
  authorHeadline: string | null;
  authorProfileUrl: string | null;
  content: string;
  postUrl: string | null;
  likes: number | null;
  comments: number | null;
  reposts: number | null;
  postedTimeAgo: string | null;
  postType:
    | 'original'
    | 'repost'
    | 'article'
    | 'poll'
    | 'event'
    | 'unknown';
}

/** Company page parsed data */
export interface CompanyParseData {
  name: string | null;
  industry: string | null;
  companySize: string | null;
  headquarters: string | null;
  founded: string | null;
  specialties: string[];
  about: string | null;
  website: string | null;
  followerCount: number | null;
  employeesOnLinkedIn: number | null;
}

/** Connections list parsed data */
export interface ConnectionsParseData {
  connections: ConnectionEntry[];
}

export interface ConnectionEntry {
  name: string;
  headline: string | null;
  profileUrl: string;
  connectedDate: string | null;
}

/** Messages page parsed data */
export interface MessagesParseData {
  conversations: ConversationEntry[];
}

export interface ConversationEntry {
  participantName: string;
  participantProfileUrl: string | null;
  lastMessagePreview: string | null;
  timestamp: string | null;
  unread: boolean;
}

/** Union of all page-type specific data */
export type PageParseData =
  | ProfileParseData
  | SearchParseData
  | FeedParseData
  | CompanyParseData
  | ConnectionsParseData
  | MessagesParseData;

/** Full result of parsing a page */
export interface ParseResult {
  success: boolean;
  pageType: LinkedInPageType;
  url: string;
  captureId: string;
  fields: ExtractedField[];
  data: PageParseData | null;
  fieldsExtracted: number;
  fieldsAttempted: number;
  overallConfidence: number;
  parseTimeMs: number;
  parserVersion: string;
  selectorConfigVersion: number;
  errors: string[];
}

/** Interface for individual page type parsers */
export interface PageParser {
  readonly pageType: LinkedInPageType;
  readonly version: string;
  parse(
    $: CheerioAPI,
    config: SelectorConfig,
    url: string
  ): Omit<ParseResult, 'captureId' | 'parseTimeMs'>;
}
