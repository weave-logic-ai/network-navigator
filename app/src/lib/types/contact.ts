export interface Contact {
  id: string;
  linkedinUrl: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  headline: string | null;
  title: string | null;
  currentCompany: string | null;
  currentCompanyId: string | null;
  location: string | null;
  about: string | null;
  email: string | null;
  phone: string | null;
  connectionsCount: number | null;
  degree: number;
  tags: string[];
  notes: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  companyName?: string;
  companyIndustry?: string;
  compositeScore?: number | null;
  tier?: string | null;
  persona?: string | null;
  enrichmentStatus?: string;
  outreachState?: string | null;
  referralLikelihood?: number | null;
  referralTier?: string | null;
  referralPersona?: string | null;
  behavioralPersona?: string | null;
}

export type TierValue = "gold" | "silver" | "bronze" | "watch" | null;

export type EnrichmentStatus = "pending" | "enriched" | "failed";

export type OutreachState =
  | "not_started"
  | "queued"
  | "sent"
  | "opened"
  | "replied"
  | "bounced";

export interface ContactListParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  search?: string;
  tier?: string;
  enrichmentStatus?: string;
}
