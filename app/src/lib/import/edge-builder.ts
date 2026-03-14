// Edge builder: 9 edge types, upsert, weight computation, JSONB properties

import { PoolClient } from 'pg';
import { EdgeType, EdgeRecord } from './types';

export async function createEdge(
  client: PoolClient,
  edge: EdgeRecord
): Promise<string> {
  // Upsert: avoid duplicate edges based on source + target + type
  const targetCol = edge.targetContactId ? 'target_contact_id' : 'target_company_id';
  const targetVal = edge.targetContactId || edge.targetCompanyId;

  const result = await client.query(
    `INSERT INTO edges (source_contact_id, ${targetCol}, edge_type, weight, properties)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      edge.sourceContactId,
      targetVal,
      edge.edgeType,
      edge.weight ?? 1.0,
      JSON.stringify(edge.properties ?? {}),
    ]
  );

  // If conflict (already exists), find and return existing ID
  if (result.rows.length === 0) {
    const existing = await client.query(
      `SELECT id FROM edges
       WHERE source_contact_id = $1
         AND ${targetCol} = $2
         AND edge_type = $3
       LIMIT 1`,
      [edge.sourceContactId, targetVal, edge.edgeType]
    );
    return existing.rows[0]?.id ?? '';
  }

  return result.rows[0].id;
}

// Connection edges from Connections.csv
export async function createConnectionEdge(
  client: PoolClient,
  selfContactId: string,
  contactId: string,
  connectedOn?: string
): Promise<string> {
  return createEdge(client, {
    sourceContactId: selfContactId,
    targetContactId: contactId,
    edgeType: 'CONNECTED_TO',
    weight: 1.0,
    properties: connectedOn ? { connected_on: connectedOn } : {},
  });
}

// Message edges from messages.csv
export async function createMessageEdge(
  client: PoolClient,
  selfContactId: string,
  contactId: string,
  messageCount: number
): Promise<string> {
  const weight = messageCount > 0 ? Math.log(messageCount + 1) : 1.0;
  return createEdge(client, {
    sourceContactId: selfContactId,
    targetContactId: contactId,
    edgeType: 'MESSAGED',
    weight,
    properties: { message_count: messageCount },
  });
}

// Endorsement edges
export async function createEndorsementEdge(
  client: PoolClient,
  sourceContactId: string,
  targetContactId: string,
  skill?: string
): Promise<string> {
  return createEdge(client, {
    sourceContactId,
    targetContactId,
    edgeType: 'ENDORSED',
    weight: 1.0,
    properties: skill ? { skill } : {},
  });
}

// Recommendation edges
export async function createRecommendationEdge(
  client: PoolClient,
  sourceContactId: string,
  targetContactId: string,
  text?: string
): Promise<string> {
  return createEdge(client, {
    sourceContactId,
    targetContactId,
    edgeType: 'RECOMMENDED',
    weight: 2.0,
    properties: text ? { recommendation_text: text } : {},
  });
}

// Invitation edges
export async function createInvitationEdge(
  client: PoolClient,
  inviterContactId: string,
  invitedContactId: string,
  sentAt?: string
): Promise<string> {
  return createEdge(client, {
    sourceContactId: inviterContactId,
    targetContactId: invitedContactId,
    edgeType: 'INVITED_BY',
    weight: 1.0,
    properties: sentAt ? { sent_at: sentAt } : {},
  });
}

// Work edges (current position)
export async function createWorksAtEdge(
  client: PoolClient,
  contactId: string,
  companyId: string,
  title?: string
): Promise<string> {
  return createEdge(client, {
    sourceContactId: contactId,
    targetCompanyId: companyId,
    edgeType: 'WORKS_AT',
    weight: 1.0,
    properties: title ? { title } : {},
  });
}

// Work edges (past position)
export async function createWorkedAtEdge(
  client: PoolClient,
  contactId: string,
  companyId: string,
  title?: string,
  startDate?: string,
  endDate?: string
): Promise<string> {
  return createEdge(client, {
    sourceContactId: contactId,
    targetCompanyId: companyId,
    edgeType: 'WORKED_AT',
    weight: 0.5,
    properties: { title, start_date: startDate, end_date: endDate },
  });
}

// Education edges
export async function createEducatedAtEdge(
  client: PoolClient,
  contactId: string,
  companyId: string,
  degree?: string,
  fieldOfStudy?: string
): Promise<string> {
  return createEdge(client, {
    sourceContactId: contactId,
    targetCompanyId: companyId,
    edgeType: 'EDUCATED_AT',
    weight: 0.5,
    properties: { degree, field_of_study: fieldOfStudy },
  });
}

// Company follows edges
export async function createFollowsCompanyEdge(
  client: PoolClient,
  contactId: string,
  companyId: string
): Promise<string> {
  return createEdge(client, {
    sourceContactId: contactId,
    targetCompanyId: companyId,
    edgeType: 'FOLLOWS_COMPANY',
    weight: 0.3,
    properties: {},
  });
}

export type { EdgeType };
