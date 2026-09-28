// Profile embedding generation for the import pipeline.
//
// Embeddings are produced in-process by the shared local model
// (`@/lib/embeddings/generator`, Xenova/all-MiniLM-L6-v2, mean-pooled and
// normalized) and written to `profile_embeddings.embedding` as a `ruvector`
// literal.
//
// This previously called `ruvector_embed('all-MiniLM-L6-v2', $2)` inside the
// INSERT. The function was absent from the inspected deployment image, and
// upstream implementations take text before model name. Each failed INSERT
// was counted but hidden by a bare catch, leaving affected imports without
// embeddings and search requests on the keyword-only fallback.

import { PoolClient } from 'pg';
import { embedTexts, toRuvectorLiteral } from '@/lib/embeddings/generator';

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

  // Report the first failure of each kind rather than swallowing every error
  // silently, which is what hid this bug.
  let reportedBatchError = false;
  let reportedRowError = false;

  for (let i = 0; i < contacts.length; i += batchSize) {
    const batch = contacts.slice(i, i + batchSize);

    const pending: Array<{ id: string; text: string }> = [];
    for (const contact of batch) {
      const sourceText = buildSourceText(contact);
      if (!sourceText) {
        result.skipped++;
        continue;
      }
      pending.push({ id: contact.id, text: sourceText });
    }

    if (pending.length === 0) continue;

    let vectors: number[][];
    try {
      vectors = await embedTexts(pending.map((p) => p.text));
    } catch (error) {
      result.errors += pending.length;
      if (!reportedBatchError) {
        reportedBatchError = true;
        console.error(
          '[import/embeddings] embedding model failed, skipping batch:',
          error instanceof Error ? error.message : error
        );
      }
      continue;
    }

    for (let j = 0; j < pending.length; j++) {
      const { id, text } = pending[j];
      const vector = vectors[j];

      if (!vector || vector.length === 0) {
        result.errors++;
        continue;
      }

      try {
        await client.query(
          `INSERT INTO profile_embeddings (contact_id, embedding, source_text, model)
           VALUES ($1, $2::ruvector, $3, 'all-MiniLM-L6-v2')
           ON CONFLICT (contact_id) DO UPDATE SET
             embedding = $2::ruvector,
             source_text = $3,
             updated_at = now_utc()`,
          [id, toRuvectorLiteral(vector), text]
        );
        result.generated++;
      } catch (error) {
        result.errors++;
        if (!reportedRowError) {
          reportedRowError = true;
          console.error(
            '[import/embeddings] failed to write embedding:',
            error instanceof Error ? error.message : error
          );
        }
      }
    }
  }

  return result;
}

// Export for testing
export { buildSourceText };
