// Local embedding generation via @huggingface/transformers (all-MiniLM-L6-v2)
// Runs in-process, no external API needed

import { query } from '../db/client';

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const BATCH_SIZE = 25;

// Lazy-loaded pipeline
let pipelinePromise: Promise<unknown> | null = null;

async function getEmbedder() {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const { pipeline } = await import('@huggingface/transformers');
      return pipeline('feature-extraction', MODEL_NAME, {
        dtype: 'fp32',
      });
    })();
  }
  return pipelinePromise;
}

function buildSourceText(contact: {
  headline?: string | null;
  title?: string | null;
  current_company?: string | null;
  about?: string | null;
}): string | null {
  const parts = [
    contact.headline,
    contact.title && contact.current_company
      ? `${contact.title} at ${contact.current_company}`
      : contact.title,
    contact.about ? contact.about.slice(0, 500) : null,
  ].filter(Boolean);

  const text = parts.join(' | ');
  return text.trim().length > 0 ? text : null;
}

export interface ReindexProgress {
  phase: string;
  current: number;
  total: number;
  detail?: string;
}

export type ProgressCallback = (progress: ReindexProgress) => void;

/**
 * Generate embeddings for all contacts missing them.
 */
export async function generateAllEmbeddings(
  onProgress?: ProgressCallback
): Promise<{ generated: number; skipped: number; errors: number }> {
  const result = { generated: 0, skipped: 0, errors: 0 };

  // Get contacts needing embeddings
  const contactsResult = await query<{
    id: string;
    headline: string | null;
    title: string | null;
    current_company: string | null;
    about: string | null;
  }>(
    `SELECT c.id, c.headline, c.title, c.current_company, c.about
     FROM contacts c
     LEFT JOIN profile_embeddings pe ON pe.contact_id = c.id
     WHERE pe.id IS NULL AND c.is_archived = FALSE
     ORDER BY c.created_at`
  );

  const contacts = contactsResult.rows;
  const total = contacts.length;

  if (total === 0) {
    onProgress?.({ phase: 'embeddings', current: 0, total: 0, detail: 'All contacts already have embeddings' });
    return result;
  }

  onProgress?.({ phase: 'embeddings', current: 0, total, detail: 'Loading embedding model...' });

  const embedder = await getEmbedder() as (texts: string[], options?: Record<string, unknown>) => Promise<{ tolist: () => number[][] }>;

  for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
    const batch = contacts.slice(i, i + BATCH_SIZE);
    const textsAndIds: Array<{ id: string; text: string }> = [];

    for (const contact of batch) {
      const text = buildSourceText(contact);
      if (!text) {
        result.skipped++;
        continue;
      }
      textsAndIds.push({ id: contact.id, text });
    }

    if (textsAndIds.length === 0) continue;

    try {
      const texts = textsAndIds.map(t => t.text);
      const output = await embedder(texts, { pooling: 'mean', normalize: true });
      const vectors = output.tolist();

      for (let j = 0; j < textsAndIds.length; j++) {
        const { id, text } = textsAndIds[j];
        const vector = vectors[j];

        try {
          // Store as ruvector using array literal
          const vectorStr = `[${vector.join(',')}]`;
          await query(
            `INSERT INTO profile_embeddings (contact_id, embedding, source_text, model)
             VALUES ($1, $2::ruvector, $3, 'all-MiniLM-L6-v2')
             ON CONFLICT (contact_id) DO UPDATE SET
               embedding = $2::ruvector,
               source_text = $3,
               updated_at = now_utc()`,
            [id, vectorStr, text]
          );
          result.generated++;
        } catch {
          result.errors++;
        }
      }
    } catch {
      result.errors += textsAndIds.length;
    }

    onProgress?.({
      phase: 'embeddings',
      current: Math.min(i + BATCH_SIZE, total),
      total,
      detail: `Generated ${result.generated} embeddings...`,
    });
  }

  return result;
}

/**
 * Regenerate ALL embeddings (drop existing first).
 */
export async function regenerateAllEmbeddings(
  onProgress?: ProgressCallback
): Promise<{ generated: number; skipped: number; errors: number }> {
  onProgress?.({ phase: 'embeddings', current: 0, total: 0, detail: 'Clearing existing embeddings...' });
  await query('TRUNCATE profile_embeddings');
  return generateAllEmbeddings(onProgress);
}
