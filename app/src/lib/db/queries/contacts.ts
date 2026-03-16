// Contact CRUD query functions with pagination, filtering, sorting

import { query } from '../client';

interface ListContactsOptions {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  tier?: string;
  company?: string;
  tags?: string[];
  search?: string;
  includeArchived?: boolean;
}

interface PaginationResult {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface ContactRow {
  id: string;
  linkedin_url: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  headline: string | null;
  title: string | null;
  current_company: string | null;
  current_company_id: string | null;
  location: string | null;
  about: string | null;
  email: string | null;
  phone: string | null;
  connections_count: number | null;
  degree: number;
  profile_image_url: string | null;
  tags: string[];
  notes: string | null;
  is_archived: boolean;
  dedup_hash: string | null;
  created_at: Date;
  updated_at: Date;
  company_name?: string | null;
  company_industry?: string | null;
  composite_score?: number | null;
  tier?: string | null;
}

const ALLOWED_SORT_COLUMNS: Record<string, string> = {
  name: 'c.full_name',
  first_name: 'c.first_name',
  last_name: 'c.last_name',
  company: 'c.current_company',
  score: 'cs.composite_score',
  created_at: 'c.created_at',
  updated_at: 'c.updated_at',
};

export async function listContacts(
  options: ListContactsOptions = {}
): Promise<{ data: ContactRow[]; pagination: PaginationResult }> {
  const {
    page = 1,
    limit = 20,
    sort = 'created_at',
    order = 'desc',
    tier,
    company,
    tags,
    search,
    includeArchived = false,
  } = options;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (!includeArchived) {
    conditions.push('c.is_archived = FALSE');
  }

  // Exclude owner/self contacts (degree 0)
  conditions.push('c.degree > 0');

  if (tier) {
    conditions.push(`cs.tier = $${paramIdx++}`);
    params.push(tier);
  }

  if (company) {
    conditions.push(`c.current_company ILIKE $${paramIdx++}`);
    params.push(`%${company}%`);
  }

  if (tags && tags.length > 0) {
    conditions.push(`c.tags && $${paramIdx++}::text[]`);
    params.push(tags);
  }

  if (search) {
    conditions.push(
      `(c.full_name ILIKE $${paramIdx} OR c.headline ILIKE $${paramIdx} OR c.title ILIKE $${paramIdx} OR c.current_company ILIKE $${paramIdx})`
    );
    params.push(`%${search}%`);
    paramIdx++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sortColumn = ALLOWED_SORT_COLUMNS[sort] || 'c.created_at';
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
  const offset = (page - 1) * limit;

  // Count query
  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM contacts c
     LEFT JOIN contact_scores cs ON cs.contact_id = c.id
     ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  // Data query
  const dataParams = [...params, limit, offset];
  const dataResult = await query<ContactRow>(
    `SELECT c.*, co.name AS company_name, co.industry AS company_industry,
            cs.composite_score, cs.tier
     FROM contacts c
     LEFT JOIN companies co ON c.current_company_id = co.id
     LEFT JOIN contact_scores cs ON cs.contact_id = c.id
     ${whereClause}
     ORDER BY ${sortColumn} ${sortOrder} NULLS LAST
     LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
    dataParams
  );

  return {
    data: dataResult.rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function getContactById(id: string): Promise<ContactRow | null> {
  const result = await query<ContactRow>(
    `SELECT c.*, co.name AS company_name, co.industry AS company_industry,
            cs.composite_score, cs.tier
     FROM contacts c
     LEFT JOIN companies co ON c.current_company_id = co.id
     LEFT JOIN contact_scores cs ON cs.contact_id = c.id
     WHERE c.id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function createContact(data: {
  linkedin_url: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  headline?: string;
  title?: string;
  current_company?: string;
  current_company_id?: string;
  location?: string;
  about?: string;
  email?: string;
  phone?: string;
  tags?: string[];
}): Promise<ContactRow> {
  const result = await query<ContactRow>(
    `INSERT INTO contacts (
      linkedin_url, first_name, last_name, full_name, headline, title,
      current_company, current_company_id, location, about, email, phone, tags
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING *`,
    [
      data.linkedin_url,
      data.first_name ?? null,
      data.last_name ?? null,
      data.full_name ?? null,
      data.headline ?? null,
      data.title ?? null,
      data.current_company ?? null,
      data.current_company_id ?? null,
      data.location ?? null,
      data.about ?? null,
      data.email ?? null,
      data.phone ?? null,
      data.tags ?? [],
    ]
  );
  return result.rows[0];
}

export async function updateContact(
  id: string,
  data: Record<string, unknown>
): Promise<ContactRow | null> {
  const allowedFields = [
    'first_name', 'last_name', 'full_name', 'headline', 'title',
    'current_company', 'current_company_id', 'location', 'about',
    'email', 'phone', 'tags', 'notes', 'is_archived',
    'connections_count', 'linkedin_url', 'degree',
  ];

  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const [key, value] of Object.entries(data)) {
    if (allowedFields.includes(key)) {
      setClauses.push(`${key} = $${idx++}`);
      values.push(value);
    }
  }

  if (setClauses.length === 0) return getContactById(id);

  values.push(id);
  const result = await query<ContactRow>(
    `UPDATE contacts SET ${setClauses.join(', ')} WHERE id = $${idx} AND is_archived = FALSE RETURNING *`,
    values
  );

  return result.rows[0] ?? null;
}

export async function deleteContact(
  id: string,
  hard: boolean = false
): Promise<boolean> {
  if (hard) {
    const result = await query('DELETE FROM contacts WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }
  const result = await query(
    'UPDATE contacts SET is_archived = TRUE WHERE id = $1 AND is_archived = FALSE',
    [id]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function searchContacts(
  searchQuery: string,
  page: number = 1,
  limit: number = 20
): Promise<{ data: ContactRow[]; pagination: PaginationResult }> {
  const offset = (page - 1) * limit;

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM contacts c
     WHERE c.is_archived = FALSE AND c.degree > 0 AND (
       c.full_name ILIKE $1 OR c.headline ILIKE $1 OR c.title ILIKE $1
       OR c.current_company ILIKE $1 OR c.email ILIKE $1
     )`,
    [`%${searchQuery}%`]
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const dataResult = await query<ContactRow>(
    `SELECT c.*, co.name AS company_name, co.industry AS company_industry,
            cs.composite_score, cs.tier
     FROM contacts c
     LEFT JOIN companies co ON c.current_company_id = co.id
     LEFT JOIN contact_scores cs ON cs.contact_id = c.id
     WHERE c.is_archived = FALSE AND c.degree > 0 AND (
       c.full_name ILIKE $1 OR c.headline ILIKE $1 OR c.title ILIKE $1
       OR c.current_company ILIKE $1 OR c.email ILIKE $1
     )
     ORDER BY similarity(c.full_name, $2) DESC
     LIMIT $3 OFFSET $4`,
    [`%${searchQuery}%`, searchQuery, limit, offset]
  );

  return {
    data: dataResult.rows,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}
