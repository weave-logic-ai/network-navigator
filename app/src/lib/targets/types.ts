// Research Tools Sprint — WS-4 target types
//
// Mirrors the `research_targets` / `research_target_state` / `research_target_icps`
// row shapes from `data/db/init/035-targets-schema.sql`. See ADR-027 for the
// one-self-per-owner + immutable-primary decisions that shape this file.

export type TargetKind = 'self' | 'contact' | 'company';

export interface ResearchTarget {
  id: string;
  tenantId: string;
  kind: TargetKind;
  ownerId: string | null;
  contactId: string | null;
  companyId: string | null;
  label: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string;
}

export interface ResearchTargetState {
  tenantId: string;
  userId: string | null;
  primaryTargetId: string | null;
  secondaryTargetId: string | null;
  revision: string;
  activeLensId: string | null;
  updatedAt: string;
}

export interface ResolvedTarget extends ResearchTarget {
  /** Display label resolved via the v_research_target view. */
  resolvedLabel: string;
  /** Pointer to the primary entity (contact_id / company_id / owner_id). */
  entityId: string;
}

export interface ResearchTargetIcp {
  targetId: string;
  icpProfileId: string;
  isDefault: boolean;
}
