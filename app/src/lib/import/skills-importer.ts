// Skills.csv importer: store skills as tags on the contact record

import { PoolClient } from 'pg';
import { parseCsv } from './csv-parser';
import { ImportError } from './types';

interface SkillsImportResult {
  totalRows: number;
  newRecords: number;
  skippedRecords: number;
  errors: ImportError[];
}

export async function importSkills(
  client: PoolClient,
  csvContent: string,
  selfContactId: string
): Promise<SkillsImportResult> {
  const result: SkillsImportResult = {
    totalRows: 0,
    newRecords: 0,
    skippedRecords: 0,
    errors: [],
  };

  const parsed = parseCsv(csvContent);
  result.totalRows = parsed.rowCount;

  const skills: string[] = [];

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i];
    const skill = row['name'] || row['skill'] || row['skill_name'] || '';
    if (skill.trim()) {
      skills.push(skill.trim());
    } else {
      result.skippedRecords++;
    }
  }

  if (skills.length > 0) {
    // Append skills as tags (merge with existing, deduplicate)
    await client.query(
      `UPDATE contacts SET tags = (
        SELECT array_agg(DISTINCT t) FROM unnest(tags || $1::text[]) t
      ) WHERE id = $2`,
      [skills, selfContactId]
    );
    result.newRecords = skills.length;
  }

  return result;
}
