// CapturePayload: sent from extension to app when a page is captured
export interface CapturePayload {
  url: string;
  pageType: 'profile' | 'search_results' | 'feed' | 'company' | 'group' | 'event';
  html: string;
  capturedAt: string;  // ISO 8601
  scrollDepth: number; // 0-100 percentage
  viewportHeight: number;
  documentHeight: number;
  metadata: {
    title?: string;
    linkedinId?: string;
    searchQuery?: string;
  };
}

// CaptureResult: returned from app after processing a capture
export interface CaptureResult {
  success: boolean;
  cacheId: string;
  contactId?: string;   // If a contact was created/updated
  companyId?: string;    // If a company was created/updated
  parsedFields: string[];
  errors: string[];
}
