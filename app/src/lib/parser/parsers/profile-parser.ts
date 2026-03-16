// Profile page parser
// Extracts name, headline, location, about, experience, education, skills
// Uses a multi-strategy approach: CSS selectors (from config), title/meta tags, and content heuristics

import type { CheerioAPI } from 'cheerio';
import type { SelectorConfig } from '@/types/selector-config';
import type {
  PageParser,
  ParseResult,
  ProfileParseData,
  ExperienceEntry,
  EducationEntry,
  ExtractedField,
} from '../types';
import { extractField, applyHeuristics } from '../selector-extractor';

export class ProfileParser implements PageParser {
  readonly pageType = 'PROFILE' as const;
  readonly version = '2.0.0';

  parse(
    $: CheerioAPI,
    config: SelectorConfig,
    url: string
  ): Omit<ParseResult, 'captureId' | 'parseTimeMs'> {
    const fields: ExtractedField[] = [];
    const errors: string[] = [];

    // Strategy 1: Try CSS selectors from config
    const selectorFields = this.extractViaSelectors($, config);
    fields.push(...selectorFields);

    // Strategy 2: Content-based extraction (works regardless of CSS class names)
    const contentFields = this.extractViaContent($, url);

    // Merge: prefer selector results if they have values, otherwise use content-based
    for (const cf of contentFields) {
      const existing = fields.find(f => f.field === cf.field);
      if (!existing || existing.value === null) {
        if (existing) {
          // Replace the empty selector result
          const idx = fields.indexOf(existing);
          fields[idx] = cf;
        } else {
          fields.push(cf);
        }
      }
    }

    // Apply heuristics from config
    const heuristicFields = applyHeuristics(fields, config.heuristics);
    fields.push(...heuristicFields);

    // Build structured data
    const data = this.buildProfileData(fields);

    const fieldsExtracted = fields.filter(f => f.value !== null && f.confidence > 0).length;
    const fieldsAttempted = fields.length;
    const confidences = fields.filter(f => f.confidence > 0).map(f => f.confidence);
    const overallConfidence = confidences.length > 0
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : 0;

    return {
      success: fieldsExtracted > 0,
      pageType: 'PROFILE',
      url,
      fields,
      data,
      fieldsExtracted,
      fieldsAttempted,
      overallConfidence: Math.round(overallConfidence * 100) / 100,
      parserVersion: this.version,
      selectorConfigVersion: config.version,
      errors,
    };
  }

  private extractViaSelectors($: CheerioAPI, config: SelectorConfig): ExtractedField[] {
    const fields: ExtractedField[] = [];
    const selectors = config.selectors;
    const allFields = ['name', 'headline', 'location', 'about', 'connectionsCount',
      'profileImageUrl', 'experience', 'education', 'skills'];

    for (const fieldName of allFields) {
      const chain = selectors[fieldName];
      if (chain) {
        fields.push(extractField($, chain, fieldName));
      }
    }
    return fields;
  }

  private extractViaContent($: CheerioAPI, url: string): ExtractedField[] {
    const fields: ExtractedField[] = [];

    // === NAME: Extract from <title> tag ===
    const title = $('title').first().text();
    const titleMatch = title.match(/^(.+?)\s*[|\-–—]\s*LinkedIn/);
    if (titleMatch) {
      const name = titleMatch[1].trim().replace(/,\s*verified$/, '');
      fields.push({
        field: 'name',
        value: name,
        confidence: 0.9,
        source: 'title-tag',
        selectorUsed: 'title',
      });
    }

    // === NAME: Also try profile URL slug as fallback ===
    if (!titleMatch) {
      const slugMatch = url.match(/\/in\/([^/?]+)/);
      if (slugMatch) {
        const slug = slugMatch[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        fields.push({
          field: 'name',
          value: slug,
          confidence: 0.5,
          source: 'url-slug',
          selectorUsed: 'url',
        });
      }
    }

    // === HEADLINE: Find text in the top card area after the name ===
    // LinkedIn puts headline in a <p> tag near the name, with pipe-separated segments
    const html = $.html();

    // Look for the headline pattern: it's typically the first substantive <p> after the profile image
    const profileLink = $(`a[href*="${url.replace('https://www.linkedin.com', '')}"] strong`);
    if (profileLink.length > 0) {
      // Walk up to find the containing div, then find the next text block
      const container = profileLink.closest('div').parent();
      const nextP = container.find('p').filter(function () {
        const text = $(this).text().trim();
        return text.length > 10 && text.length < 500 && !text.includes('profile picture');
      });
      if (nextP.length > 0) {
        const headline = nextP.first().text().trim();
        fields.push({
          field: 'headline',
          value: headline,
          confidence: 0.8,
          source: 'content-heuristic',
          selectorUsed: 'profile-link-sibling',
        });
      }
    }

    // === PROFILE IMAGE: Find img with profile picture alt text ===
    const profileImg = $('img[alt*="profile picture"]').first();
    if (profileImg.length > 0) {
      const src = profileImg.attr('src');
      if (src && src.startsWith('http')) {
        fields.push({
          field: 'profileImageUrl',
          value: src,
          confidence: 0.95,
          source: 'content-heuristic',
          selectorUsed: 'img[alt*="profile picture"]',
        });
      }
    }

    // === ABOUT: Find text near "About" heading ===
    // LinkedIn uses section IDs or heading text
    const aboutSection = this.findSectionContent($, html, ['About']);
    if (aboutSection) {
      fields.push({
        field: 'about',
        value: aboutSection,
        confidence: 0.7,
        source: 'content-heuristic',
        selectorUsed: 'section-heading-about',
      });
    }

    // === LOCATION: Look for location patterns (City, State/Country) ===
    const locationPattern = $('*').filter(function () {
      const text = $(this).text().trim();
      // Location patterns: "City, State", "City, Country", etc.
      return (
        text.length > 3 &&
        text.length < 100 &&
        /^[A-Z][a-z]+(?:[\s,]+[A-Z][a-z]+)*(?:,\s*[A-Z][a-z]+)*\s*(?:Area)?$/.test(text) &&
        $(this).children().length === 0
      );
    });
    // Find the one closest to the name/headline area
    if (locationPattern.length > 0) {
      const loc = locationPattern.first().text().trim();
      fields.push({
        field: 'location',
        value: loc,
        confidence: 0.6,
        source: 'content-heuristic',
        selectorUsed: 'location-pattern',
      });
    }

    // === CONNECTIONS: Find "xxx connections" text ===
    const connText = html.match(/(\d[\d,]*)\+?\s+connections/i);
    if (connText) {
      const count = parseInt(connText[1].replace(/,/g, ''), 10);
      fields.push({
        field: 'connectionsCount',
        value: count,
        confidence: 0.85,
        source: 'content-heuristic',
        selectorUsed: 'text-pattern',
      });
    }

    // === EXPERIENCE: Find section content after "Experience" heading ===
    // (basic extraction - structured parsing is complex due to hashed classes)

    // === SKILLS: Find section content after "Skills" heading ===

    return fields;
  }

  private findSectionContent($: CheerioAPI, html: string, headings: string[]): string | null {
    for (const heading of headings) {
      // Try to find the section by looking for the heading text
      const regex = new RegExp(`>${heading}</(?:h[1-6]|p|span|div)>([\\s\\S]{10,2000}?)(?:<(?:h[1-6]|section)|$)`, 'i');
      const match = html.match(regex);
      if (match) {
        // Strip HTML tags from the content
        const content = match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (content.length > 10) {
          return content.substring(0, 2000);
        }
      }
    }
    return null;
  }

  private buildProfileData(fields: ExtractedField[]): ProfileParseData {
    const getValue = (fieldName: string): string | null => {
      const field = fields.find(f => f.field === fieldName);
      if (!field || field.value === null) return null;
      return typeof field.value === 'string' ? field.value
        : typeof field.value === 'number' ? String(field.value)
        : null;
    };

    const getNumValue = (fieldName: string): number | null => {
      const field = fields.find(f => f.field === fieldName);
      if (!field || field.value === null) return null;
      if (typeof field.value === 'number') return field.value;
      if (typeof field.value === 'string') {
        const n = parseInt(field.value.replace(/[,\s]/g, ''), 10);
        return isNaN(n) ? null : n;
      }
      return null;
    };

    const getArrayValue = (fieldName: string): string[] => {
      const field = fields.find(f => f.field === fieldName);
      if (!field || field.value === null) return [];
      if (Array.isArray(field.value)) return field.value;
      return typeof field.value === 'string' ? [field.value] : [];
    };

    const experienceEntries: ExperienceEntry[] = [];
    const expElements = getArrayValue('experience');
    for (const expText of expElements) {
      const lines = expText.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length >= 2) {
        experienceEntries.push({
          title: lines[0],
          company: lines[1] ?? '',
          duration: lines[2] ?? null,
          startDate: null,
          endDate: null,
          location: null,
          description: lines.slice(3).join(' ') || null,
          isCurrent: (lines[2] ?? '').toLowerCase().includes('present'),
        });
      }
    }

    const educationEntries: EducationEntry[] = [];
    const eduElements = getArrayValue('education');
    for (const eduText of eduElements) {
      const lines = eduText.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length >= 1) {
        educationEntries.push({
          school: lines[0],
          degree: lines[1] ?? null,
          fieldOfStudy: lines[2] ?? null,
          startYear: null,
          endYear: null,
        });
      }
    }

    return {
      name: getValue('name'),
      headline: getValue('headline'),
      location: getValue('location'),
      about: getValue('about'),
      connectionsCount: getNumValue('connectionsCount'),
      experience: experienceEntries,
      education: educationEntries,
      skills: getArrayValue('skills'),
      profileImageUrl: getValue('profileImageUrl'),
    };
  }
}
