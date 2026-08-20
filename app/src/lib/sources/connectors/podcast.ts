// Podcast connector.
//
// Accepts a podcast RSS feed URL (standard iTunes/Spotify-compatible RSS).
// For each `<item>`:
//   1. Resolve transcript source. Priority:
//        a) `<podcast:transcript>` element (per
//           https://podcastindex.org/namespace/1.0) — fetch the URL and store
//           the transcript body inline.
//        b) `<itunes:summary>` — stored as a degraded-but-structured fallback.
//        c) `<description>` — lowest-priority fallback.
//   2. Parse {title, pubDate, duration, guestNames[], transcriptAvailable,
//      transcriptUrl?} and write a source_records row per episode.
//
// User-uploaded transcripts arrive via `POST /api/sources/podcast/transcript`
// (route file) which stores the transcript in `source_field_values` keyed
// on the matching episode record. The route imports the helpers here for the
// format-aware body extractor.
//
// Interface contract: `SourceConnector<PodcastInput>` per `../types.ts`. This
// file does not touch the DB directly beyond `writeSourceRecord`.

import * as cheerio from 'cheerio';
import { gatedFetch, writeSourceRecord, SourceFetchError } from '../service';
import { canonicalizeUrl } from '../url-normalize';
import { applyRecencyModifier, RECENCY_PRESETS } from './recency-modifier';
import type {
  SourceConnector,
  ConnectorContext,
  ConnectorResult,
  SourceType,
} from '../types';

export interface PodcastInput {
  /** The podcast RSS feed URL. */
  feedUrl: string;
  /** Upper bound on episodes to pull in one invocation. Default 25. */
  maxEpisodes?: number;
}

export interface PodcastEpisodePayload {
  title: string | null;
  pubDate: string | null; // ISO 8601
  duration: number | null; // seconds
  guid: string;
  guestNames: string[];
  transcriptAvailable: boolean;
  transcriptUrl?: string;
  transcriptFormat?: 'srt' | 'vtt' | 'plain' | 'json' | 'html';
  summary: string | null;
}

const PODCAST_SOURCE_TYPE: SourceType = 'podcast';

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent':
    'NetworkNavigator-Research/1.0 (podcast-connector; contact: research@weavelogic.ai)',
  Accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.5',
};

/**
 * Parse a raw RSS feed body into episode records. Exposed for tests.
 */
export function parsePodcastFeed(xml: string): {
  channelTitle: string | null;
  episodes: PodcastEpisodePayload[];
} {
  const $ = cheerio.load(xml, { xmlMode: true });
  const channelTitle = $('channel > title').first().text().trim() || null;

  const episodes: PodcastEpisodePayload[] = [];
  $('channel > item, item').each((_i, el) => {
    const $item = $(el);
    const title = $item.find('title').first().text().trim() || null;
    const pubRaw =
      $item.find('pubDate').first().text().trim() ||
      $item.find('dc\\:date').first().text().trim();
    const pubDate = pubRaw ? toIsoDate(pubRaw) : null;
    const guid =
      $item.find('guid').first().text().trim() ||
      $item.find('enclosure').first().attr('url') ||
      (title ?? '');

    // Duration: `<itunes:duration>` can be seconds-only or HH:MM:SS.
    const durationRaw = $item.find('itunes\\:duration').first().text().trim();
    const duration = durationRaw ? parseDuration(durationRaw) : null;

    // Transcript: <podcast:transcript> has both url + type attributes.
    const transcript = $item.find('podcast\\:transcript').first();
    const transcriptUrl = transcript.attr('url');
    const transcriptTypeAttr = (transcript.attr('type') ?? '').toLowerCase();
    const transcriptFormat = mapTranscriptType(transcriptTypeAttr);

    // Summary priority: itunes:summary → description.
    const itunesSummary =
      $item.find('itunes\\:summary').first().text().trim() || null;
    const description = $item.find('description').first().text().trim() || null;
    const summary = itunesSummary ?? description ?? null;

    const guestNames = extractGuestNames(title ?? '', summary ?? '');

    episodes.push({
      title,
      pubDate,
      duration,
      guid,
      guestNames,
      transcriptAvailable: Boolean(transcriptUrl),
      transcriptUrl,
      transcriptFormat,
      summary,
    });
  });
  return { channelTitle, episodes };
}

/**
 * Parse HH:MM:SS / MM:SS / plain-seconds strings to integer seconds. Returns
 * null on malformed input.
 */
export function parseDuration(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const parts = trimmed.split(':').map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

/** Extract guest names with a simple heuristic:
 *  1. "Episode N: <Guest Name> on <topic>" — everything after the colon, before ' on '.
 *  2. "Guest: <Name>" markers inside the summary.
 *  3. "Interview with <Name>" pattern in title or summary.
 */
export function extractGuestNames(title: string, summary: string): string[] {
  const hits = new Set<string>();

  // 1. Colon/dash pattern in title: "Ep 42 — Jane Doe on Whatever". The name
  //    capture stops at a lower-case connector (" on ", " at ", " about ",
  //    " with ") so we don't sweep the topic into the name.
  const colonMatch = title.match(
    /(?:episode|ep|#)[^:—–-]*[:—–-]\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})(?=\s+(?:on|at|about|with|joins|talks|discusses|and|,|\.|$))/i
  );
  if (colonMatch) hits.add(colonMatch[1].trim());

  // 2. "Interview with <Name>".
  const interviewRe = /interview(?:ing)?\s+with\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/gi;
  for (const match of `${title}\n${summary}`.matchAll(interviewRe)) {
    if (match[1]) hits.add(match[1]);
  }

  // 3. "Guest: <Name>" or "Guests: <Name>, <Name>" in summary.
  const guestLineRe = /\bguests?\s*[:\-—]\s*([^\n.]+)/gi;
  for (const match of summary.matchAll(guestLineRe)) {
    const frag = match[1];
    const names = frag.split(/,|&| and /i);
    for (const n of names) {
      const cleaned = n.trim().replace(/[.;].*$/, '');
      if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}$/.test(cleaned)) {
        hits.add(cleaned);
      }
    }
  }

  return Array.from(hits);
}

function toIsoDate(raw: string): string | null {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function mapTranscriptType(
  type: string
): 'srt' | 'vtt' | 'plain' | 'json' | 'html' | undefined {
  if (!type) return undefined;
  if (/vtt/i.test(type)) return 'vtt';
  if (/srt|subrip/i.test(type)) return 'srt';
  if (/json/i.test(type)) return 'json';
  if (/html/i.test(type)) return 'html';
  if (/plain|text/i.test(type)) return 'plain';
  return undefined;
}

/** Strip timestamps from SRT or VTT to produce plain text. Exposed for the
 *  user-upload endpoint so we can flatten uploaded subtitles to searchable text.
 */
export function flattenSubtitleText(
  body: string,
  format: 'srt' | 'vtt' | 'plain'
): string {
  if (format === 'plain') return body.trim();
  // Remove WEBVTT header, NOTE/STYLE/REGION blocks for VTT.
  const stripped = body
    .replace(/^WEBVTT.*$/gim, '')
    .replace(/^NOTE[^\n]*(\n(?!\n).*)*/gim, '');
  // Pull out lines that are not timecodes or cue identifiers.
  const lines: string[] = [];
  for (const line of stripped.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^\d+$/.test(trimmed)) continue; // SRT cue id
    if (/-->/i.test(trimmed)) continue; // SRT/VTT timecode
    lines.push(trimmed);
  }
  return lines.join(' ').replace(/\s+/g, ' ').trim();
}

export const podcastConnector: SourceConnector<PodcastInput> = {
  sourceType: PODCAST_SOURCE_TYPE,
  label: 'Podcast',

  async invoke(
    input: PodcastInput,
    ctx: ConnectorContext
  ): Promise<ConnectorResult> {
    const warnings: string[] = [];
    const maxEpisodes = Math.max(1, Math.min(input.maxEpisodes ?? 25, 100));

    const feedCanonical = canonicalizeUrl(input.feedUrl);

    const feedResp = await gatedFetch(feedCanonical, {
      tenantId: ctx.tenantId,
      headers: DEFAULT_HEADERS,
      timeoutMs: 30_000,
      maxBytes: 5 * 1024 * 1024,
    });
    const xml = feedResp.bytes.toString('utf-8');
    const parsed = parsePodcastFeed(xml);
    const episodes = parsed.episodes.slice(0, maxEpisodes);

    let lastRecordId: string | null = null;
    let newCount = 0;
    let totalBytes = 0;

    for (const ep of episodes) {
      const sourceId = `${feedCanonical}::${ep.guid}`;

      // Transcript fetch (best-effort, bounded).
      let transcriptBody: Buffer | null = null;
      let transcriptActualFormat = ep.transcriptFormat;
      if (ep.transcriptAvailable && ep.transcriptUrl) {
        try {
          const tResp = await gatedFetch(ep.transcriptUrl, {
            tenantId: ctx.tenantId,
            headers: DEFAULT_HEADERS,
            timeoutMs: 30_000,
            maxBytes: 5 * 1024 * 1024,
          });
          transcriptBody = tResp.bytes;
          if (!transcriptActualFormat) {
            transcriptActualFormat = mapTranscriptType(tResp.contentType);
          }
        } catch (err) {
          if (err instanceof SourceFetchError) {
            warnings.push(
              `Transcript fetch failed for "${ep.title}": ${err.code}`
            );
          } else {
            warnings.push(
              `Transcript fetch failed for "${ep.title}": ${(err as Error).message}`
            );
          }
        }
      }

      // Body priority: transcript > itunes:summary > description (summary).
      const storedBody = transcriptBody ?? Buffer.from(ep.summary ?? '', 'utf-8');
      const contentMime = transcriptBody
        ? transcriptFormatToMime(transcriptActualFormat)
        : 'text/plain';

      // ADR-030 per-item multiplier: podcasts expose no engagement count
      // (RSS carries no listen/download numbers) and citation count is
      // unbuilt repo-wide, so recency (episode age) is the only signal
      // available — matches ADR-030's own "podcast has no native engagement
      // count" consequence note.
      const perItemMultiplier = applyRecencyModifier(
        1.0,
        ep.pubDate,
        RECENCY_PRESETS.podcast
      );

      const metadata: Record<string, unknown> = {
        title: ep.title,
        pubDate: ep.pubDate,
        duration: ep.duration,
        guestNames: ep.guestNames,
        transcriptAvailable: ep.transcriptAvailable && Boolean(transcriptBody),
        transcriptUrl: ep.transcriptUrl ?? null,
        transcriptFormat: transcriptActualFormat ?? null,
        feedUrl: feedCanonical,
        channelTitle: parsed.channelTitle,
        perItemMultiplier,
        fallback: transcriptBody
          ? 'transcript'
          : ep.summary
            ? 'itunes:summary-or-description'
            : 'none',
      };

      const record = await writeSourceRecord({
        tenantId: ctx.tenantId,
        sourceType: PODCAST_SOURCE_TYPE,
        sourceId,
        url: ep.transcriptUrl ?? feedCanonical,
        title: ep.title,
        publishedAt: ep.pubDate,
        body: storedBody,
        contentMime,
        metadata,
      });
      if (record.isNew) newCount += 1;
      lastRecordId = record.id;
      totalBytes += record.bytes;
    }

    return {
      sourceType: PODCAST_SOURCE_TYPE,
      sourceRecordId: lastRecordId,
      canonicalUrl: feedCanonical,
      isNew: newCount > 0,
      bytes: totalBytes,
      summary: `Podcast "${parsed.channelTitle ?? feedCanonical}": ${episodes.length} episode(s), ${newCount} new`,
      metadata: {
        channelTitle: parsed.channelTitle,
        episodeCount: episodes.length,
        newCount,
      },
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  },
};

function transcriptFormatToMime(
  format: PodcastEpisodePayload['transcriptFormat']
): string {
  switch (format) {
    case 'srt':
      return 'application/x-subrip';
    case 'vtt':
      return 'text/vtt';
    case 'json':
      return 'application/json';
    case 'html':
      return 'text/html';
    case 'plain':
    default:
      return 'text/plain';
  }
}
