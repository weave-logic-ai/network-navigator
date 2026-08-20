// SEC EDGAR connector.
//
// Flow:
//   1. Pad the input CIK to 10 digits.
//   2. Fetch `https://data.sec.gov/submissions/CIK<10-digit>.json` (SEC
//      requires `User-Agent: NetworkNav <email>` — configurable via
//      SEC_USER_AGENT env, with a safe default).
//   3. Parse the filings index. Pick up to `limit` (default 3) of the 10-Ks.
//   4. For each filing, fetch the primary index doc, extract the Item 1A
//      (Risk Factors) and Item 10 (Directors / Officers) sections — best
//      effort; if markers are missing we store the full body up to the
//      5 MB cap.
//   5. Write one source_records row per filing. Add source_field_values
//      rows for the extracted sections so the trust-weighted projection can
//      read them.
//
// SEC rate limits: 10 req/sec per IP. We stay well under that with the shared
// rate limiter at 10 req/min — worst-case a 3-filing backfill takes ~1 minute.
// The robots check is explicitly skipped: SEC publishes the submissions API
// as fair-use for programmatic access; `www.sec.gov/robots.txt` blanket-
// disallows most crawlers but the data.sec.gov API is documented as exempt.

import { gatedFetch, writeSourceRecord } from '../service';
import { query } from '../../db/client';
import { applyRecencyModifier, RECENCY_PRESETS } from './recency-modifier';
import type {
  SourceConnector,
  EdgarInput,
  ConnectorContext,
  ConnectorResult,
} from '../types';

const SUBMISSIONS_BASE = 'https://data.sec.gov/submissions';
const ARCHIVE_BASE = 'https://www.sec.gov/Archives/edgar/data';

function getUserAgent(): string {
  return process.env.SEC_USER_AGENT ?? 'NetworkNav research@weavelogic.ai';
}

/** Pad a CIK to 10 digits (leading zeros). */
export function padCik(cik: string): string {
  const cleaned = String(cik).replace(/[^0-9]/g, '');
  if (cleaned.length === 0) {
    throw new Error(`Invalid CIK: ${cik}`);
  }
  return cleaned.padStart(10, '0');
}

/** Parse the SEC submissions JSON. Returns recent filings with metadata. */
export interface EdgarFiling {
  accessionNumber: string;
  filingDate: string;
  reportDate: string | null;
  form: string;
  primaryDocument: string;
  primaryDocDescription: string | null;
}

export function parseSubmissions(body: unknown): {
  cik: string;
  name: string;
  filings: EdgarFiling[];
} {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid EDGAR submissions response');
  }
  const data = body as Record<string, unknown>;
  const recent =
    (data.filings as Record<string, unknown> | undefined)?.recent as
      | Record<string, unknown>
      | undefined;
  if (!recent) {
    return {
      cik: String(data.cik ?? ''),
      name: String(data.name ?? ''),
      filings: [],
    };
  }
  const accessionNumbers = (recent.accessionNumber as string[]) ?? [];
  const filingDates = (recent.filingDate as string[]) ?? [];
  const reportDates = (recent.reportDate as string[]) ?? [];
  const forms = (recent.form as string[]) ?? [];
  const primaryDocuments = (recent.primaryDocument as string[]) ?? [];
  const primaryDocDescriptions =
    (recent.primaryDocDescription as string[]) ?? [];

  const filings: EdgarFiling[] = [];
  for (let i = 0; i < accessionNumbers.length; i++) {
    filings.push({
      accessionNumber: accessionNumbers[i] ?? '',
      filingDate: filingDates[i] ?? '',
      reportDate: reportDates[i] || null,
      form: forms[i] ?? '',
      primaryDocument: primaryDocuments[i] ?? '',
      primaryDocDescription: primaryDocDescriptions[i] || null,
    });
  }
  return {
    cik: String(data.cik ?? ''),
    name: String(data.name ?? ''),
    filings,
  };
}

/**
 * Build the URL to the primary document for a filing. Accession numbers look
 * like `0001193125-24-012345` — for the URL we need the CIK-level folder
 * plus the dashless accession number.
 */
export function primaryDocUrl(
  cik: string,
  accessionNumber: string,
  primaryDocument: string
): string {
  const cikNoPad = String(Number(cik)); // strip leading zeros
  const dashless = accessionNumber.replace(/-/g, '');
  return `${ARCHIVE_BASE}/${cikNoPad}/${dashless}/${primaryDocument}`;
}

/**
 * Very rough section extractor for 10-K filings. Looks for Item 1A (Risk
 * Factors) and Item 10 (Directors / Officers / Corporate Governance) headers
 * and returns the slices between them and the next Item heading. Best-effort;
 * we do not aim for legal-grade extraction here.
 */
export function extract10KSections(htmlOrText: string): {
  riskFactors: string | null;
  directorsOfficers: string | null;
} {
  // Strip tags to work on text. Simple `<[^>]+>` removal — not perfect on
  // nested/unbalanced HTML, but adequate for section headers.
  const text = htmlOrText
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ');

  function sliceBetween(startRe: RegExp, endRe: RegExp): string | null {
    const start = text.search(startRe);
    if (start < 0) return null;
    const rest = text.slice(start);
    const endIdx = rest.slice(40).search(endRe); // skip past the matched header
    if (endIdx < 0) return rest.slice(0, 100_000).trim(); // cap at 100k chars
    return rest.slice(0, 40 + endIdx).trim();
  }

  const itemHeader = /Item\s+\d+[A-Z]?[\.\s]/i;
  const riskFactors = sliceBetween(/Item\s+1A[\.\s]/i, itemHeader);
  const directorsOfficers = sliceBetween(/Item\s+10[\.\s]/i, itemHeader);

  return { riskFactors, directorsOfficers };
}

export const edgarConnector: SourceConnector<EdgarInput> = {
  sourceType: 'edgar',
  label: 'SEC EDGAR',

  async invoke(
    input: EdgarInput,
    ctx: ConnectorContext
  ): Promise<ConnectorResult> {
    const cik = padCik(input.cik);
    const limit = Math.max(1, Math.min(input.limit ?? 3, 20));
    const warnings: string[] = [];

    const submissionsUrl = `${SUBMISSIONS_BASE}/CIK${cik}.json`;
    const submissionsResp = await gatedFetch(submissionsUrl, {
      tenantId: ctx.tenantId,
      headers: {
        'User-Agent': getUserAgent(),
        Accept: 'application/json',
      },
      // SEC's data.sec.gov API is programmatic; robots.txt does not cover it.
      skipRobots: true,
      timeoutMs: 15_000,
      maxBytes: 10 * 1024 * 1024,
    });
    const submissions = parseSubmissions(
      JSON.parse(submissionsResp.bytes.toString('utf-8'))
    );

    // Prioritize 10-K filings.
    const tenKs = submissions.filings
      .filter((f) => /^10-K/.test(f.form))
      .slice(0, limit);
    if (tenKs.length === 0) {
      return {
        sourceType: 'edgar',
        sourceRecordId: null,
        canonicalUrl: submissionsUrl,
        isNew: false,
        bytes: 0,
        summary: `No 10-K filings found for CIK ${cik} (${submissions.name})`,
        warnings,
      };
    }

    let lastRecordId: string | null = null;
    let totalBytes = 0;
    let newCount = 0;

    for (const filing of tenKs) {
      try {
        const docUrl = primaryDocUrl(
          cik,
          filing.accessionNumber,
          filing.primaryDocument
        );

        // Dedup: skip if we already have the row.
        if (input.dedup !== false) {
          const existing = await query<{ id: string }>(
            `SELECT id FROM source_records
             WHERE tenant_id = $1 AND source_type = 'edgar' AND source_id = $2`,
            [ctx.tenantId, filing.accessionNumber]
          );
          if (existing.rows[0]) {
            warnings.push(
              `Skipped existing filing ${filing.accessionNumber}`
            );
            continue;
          }
        }

        const docResp = await gatedFetch(docUrl, {
          tenantId: ctx.tenantId,
          headers: {
            'User-Agent': getUserAgent(),
            Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
          },
          skipRobots: true,
          timeoutMs: 30_000,
          maxBytes: 5 * 1024 * 1024,
        });

        const htmlOrText = docResp.bytes.toString('utf-8');
        const sections = extract10KSections(htmlOrText);

        const metadata: Record<string, unknown> = {
          edgar: {
            cik,
            companyId: input.companyId,
            name: submissions.name,
            accessionNumber: filing.accessionNumber,
            form: filing.form,
            filingDate: filing.filingDate,
            reportDate: filing.reportDate,
            primaryDocument: filing.primaryDocument,
            hasRiskFactors: Boolean(sections.riskFactors),
            hasDirectorsOfficers: Boolean(sections.directorsOfficers),
          },
        };

        const record = await writeSourceRecord({
          tenantId: ctx.tenantId,
          sourceType: 'edgar',
          sourceId: filing.accessionNumber,
          url: docUrl,
          title: `${submissions.name} — ${filing.form} (${filing.filingDate})`,
          publishedAt: filing.filingDate,
          body: docResp.bytes,
          contentMime: docResp.contentType,
          metadata,
        });
        if (record.isNew) newCount += 1;
        lastRecordId = record.id;
        totalBytes += record.bytes;

        // Link the source_record to the company entity.
        await query(
          `INSERT INTO source_record_entities
             (source_record_id, entity_kind, entity_id, role, confidence, extracted_by)
           VALUES ($1, 'company', $2, 'issuer', 0.95, 'connector-rule')
           ON CONFLICT DO NOTHING`,
          [record.id, input.companyId]
        );

        // Write field-level rows for the extracted sections. These feed the
        // composite-trust projection (ADR-030) so the "current officers"
        // field can be sourced from an EDGAR filing with edgar's category
        // default weight (1.40).
        if (sections.riskFactors) {
          await writeFieldValue(
            ctx.tenantId,
            record.id,
            input.companyId,
            'risk_factors',
            sections.riskFactors.slice(0, 50_000),
            filing.filingDate
          );
        }
        if (sections.directorsOfficers) {
          await writeFieldValue(
            ctx.tenantId,
            record.id,
            input.companyId,
            'directors_officers',
            sections.directorsOfficers.slice(0, 50_000),
            filing.filingDate
          );
        }
      } catch (err) {
        warnings.push(
          `Failed to fetch ${filing.accessionNumber}: ${(err as Error).message}`
        );
      }
    }

    return {
      sourceType: 'edgar',
      sourceRecordId: lastRecordId,
      canonicalUrl: submissionsUrl,
      isNew: newCount > 0,
      bytes: totalBytes,
      summary: `Fetched ${tenKs.length} 10-K filings for CIK ${cik} (${newCount} new)`,
      metadata: {
        cik,
        companyName: submissions.name,
        filingCount: tenKs.length,
        newCount,
      },
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  },
};

async function writeFieldValue(
  tenantId: string,
  sourceRecordId: string,
  companyId: string,
  fieldName: string,
  value: string,
  referencedDate: string | null
): Promise<void> {
  // Look up the category_default_snapshot for 'edgar' per tenant.
  const res = await query<{ category_default: number }>(
    `SELECT category_default FROM source_type_weights
     WHERE tenant_id = $1 AND source_type = 'edgar'`,
    [tenantId]
  );
  const categoryDefault = res.rows[0]?.category_default ?? 1.4;

  // ADR-030 recency modifier: a filing's extracted fields (risk factors,
  // directors/officers) get less trustworthy relative to baseline the older
  // the filing is. No engagement or citation signal exists for EDGAR filings
  // (SEC documents don't carry view counts, and citation count is unbuilt
  // repo-wide — see recency-modifier.ts), so recency is the only per-item
  // signal EDGAR can compute; it replaces the previous hardcoded 1.0.
  const perItemMultiplier = applyRecencyModifier(
    1.0,
    referencedDate,
    RECENCY_PRESETS.edgar
  );

  await query(
    `INSERT INTO source_field_values
       (tenant_id, source_record_id, subject_kind, subject_id, field_name,
        field_value, referenced_date, category_default_snapshot,
        per_item_multiplier, extracted_by)
     VALUES ($1, $2, 'company', $3, $4, $5::jsonb, $6, $7, $8, 'connector-rule')
     ON CONFLICT (source_record_id, subject_kind, subject_id, field_name) DO UPDATE
       SET field_value = EXCLUDED.field_value,
           referenced_date = EXCLUDED.referenced_date,
           category_default_snapshot = EXCLUDED.category_default_snapshot,
           per_item_multiplier = EXCLUDED.per_item_multiplier`,
    [
      tenantId,
      sourceRecordId,
      companyId,
      fieldName,
      JSON.stringify({ text: value }),
      referencedDate,
      categoryDefault,
      perItemMultiplier,
    ]
  );
}
