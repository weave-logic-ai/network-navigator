// Profile embedding generation via ruvector_embed()

import { PoolClient } from 'pg';

interface EmbeddingResult {
  generated: number;
  skipped: number;
  errors: number;
}

function buildSourceText(contact: {
  headline?: string;
  title?: string;
  current_company?: string;
  about?: string;
}): string | null {
  const parts = [
    contact.headline,
    contact.title && contact.current_company
      ? `${contact.title} at ${contact.current_company}`
      : contact.title,
    contact.about,
  ].filter(Boolean);

  const text = parts.join(' | ');
  return text.trim().length > 0 ? text : null;
}

export async function generateEmbeddings(
  client: PoolClient,
  batchSize: number = 50
): Promise<EmbeddingResult> {
  const result: EmbeddingResult = { generated: 0, skipped: 0, errors: 0 };

  // Get contacts that don't have embeddings yet
  const contactsResult = await client.query(
    `SELECT c.id, c.headline, c.title, c.current_company, c.about
     FROM contacts c
     LEFT JOIN profile_embeddings pe ON pe.contact_id = c.id
     WHERE pe.id IS NULL AND c.is_archived = FALSE`
  );

  const contacts = contactsResult.rows;

  for (let i = 0; i < contacts.length; i += batchSize) {
    const batch = contacts.slice(i, i + batchSize);

    for (const contact of batch) {
      const sourceText = buildSourceText(contact);

      if (!sourceText) {
        result.skipped++;
        continue;
      }

      try {
        // Use ruvector_embed() to generate 384-dim vector
        await client.query(
          `INSERT INTO profile_embeddings (contact_id, embedding, source_text, model)
           VALUES ($1, ruvector_embed('all-MiniLM-L6-v2', $2), $3, 'all-MiniLM-L6-v2')
           ON CONFLICT (contact_id) DO UPDATE SET
             embedding = ruvector_embed('all-MiniLM-L6-v2', $2),
             source_text = $3,
             updated_at = now_utc()`,
          [contact.id, sourceText, sourceText]
        );
        result.generated++;
      } catch {
        result.errors++;
      }
    }
  }

  return result;
}

// Export for testing
export { buildSourceText };
