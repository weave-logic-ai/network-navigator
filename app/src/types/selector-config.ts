// Types for LinkedIn page selector configurations
// Used by the parser engine to extract structured data from captured HTML

export type LinkedInPageType =
  | 'PROFILE'
  | 'PROFILE_ACTIVITY'
  | 'SEARCH_PEOPLE'
  | 'SEARCH_CONTENT'
  | 'FEED'
  | 'COMPANY'
  | 'CONNECTIONS'
  | 'MESSAGES'
  | 'OTHER';

export interface SelectorChain {
  /** Human-readable name for this selector chain */
  name: string;
  /** Ordered list of CSS selectors to try; first match wins */
  selectors: string[];
  /** Attribute to extract (default: textContent) */
  attribute?: string;
  /** Post-processing: 'trim' | 'parseInt' | 'parseConnectionCount' | 'joinArray' */
  transform?: string;
  /** If true, collect all matches (not just first) */
  multiple?: boolean;
}

export interface HeuristicRule {
  /** Field this heuristic extracts */
  field: string;
  /** Regex pattern to match against extracted text */
  pattern: string;
  /** Flags for the regex */
  flags?: string;
  /** Capture group index (default: 1) */
  captureGroup?: number;
  /** Source field to run regex against */
  sourceField: string;
}

export interface SelectorConfig {
  id: string;
  pageType: LinkedInPageType;
  version: number;
  selectors: Record<string, SelectorChain>;
  heuristics: HeuristicRule[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  notes: string | null;
}

/** Row-level selector config from DB (legacy per-row format) */
export interface SelectorConfigRow {
  id: string;
  page_type: string;
  selector_name: string;
  css_selector: string;
  fallback_selectors: string[];
  extraction_method: string;
  attribute_name: string | null;
  regex_pattern: string | null;
  is_active: boolean;
  version: number;
  selectors_json: Record<string, SelectorChain> | null;
  heuristics: HeuristicRule[] | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/** Transform a DB row to the SelectorConfig interface */
export function toSelectorConfig(row: SelectorConfigRow): SelectorConfig {
  return {
    id: row.id,
    pageType: row.page_type as LinkedInPageType,
    version: row.version,
    selectors: row.selectors_json ?? {},
    heuristics: row.heuristics ?? [],
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    notes: row.notes,
  };
}
