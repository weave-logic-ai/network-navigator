-- 017-extension-schema.sql
-- Phase 4: Extension support tables and enhancements
-- Adds JSONB selector_configs approach alongside existing per-row config,
-- page_cache column additions, extension_tokens table, extension_settings

-- ===========================================================
-- Enhanced selector_configs: add JSONB selectors column and heuristics
-- The existing table stores one selector per row. We add an alternate
-- view that groups them by page_type+version with a JSONB blob for
-- the full selector chain config used by the parser engine.
-- ===========================================================

-- Add missing columns to selector_configs if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'selector_configs'
      AND column_name = 'selectors_json'
  ) THEN
    ALTER TABLE selector_configs ADD COLUMN selectors_json JSONB;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'selector_configs'
      AND column_name = 'heuristics'
  ) THEN
    ALTER TABLE selector_configs ADD COLUMN heuristics JSONB DEFAULT '[]'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'selector_configs'
      AND column_name = 'notes'
  ) THEN
    ALTER TABLE selector_configs ADD COLUMN notes TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'selector_configs'
      AND column_name = 'created_by'
  ) THEN
    ALTER TABLE selector_configs ADD COLUMN created_by TEXT DEFAULT 'system';
  END IF;
END $$;

-- Deactivation trigger: when a new active config is inserted for a page_type,
-- deactivate previous active configs for that page_type
CREATE OR REPLACE FUNCTION deactivate_previous_selector_config()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE selector_configs
  SET is_active = false, updated_at = now_utc()
  WHERE page_type = NEW.page_type
    AND id != NEW.id
    AND is_active = true
    AND selector_name = NEW.selector_name;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop and recreate to avoid conflict
DROP TRIGGER IF EXISTS trg_selector_config_activate ON selector_configs;
CREATE TRIGGER trg_selector_config_activate
  AFTER INSERT ON selector_configs
  FOR EACH ROW
  WHEN (NEW.is_active = true)
  EXECUTE FUNCTION deactivate_previous_selector_config();

-- ===========================================================
-- Add additional columns to page_cache for extension captures
-- ===========================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'page_cache'
      AND column_name = 'capture_id'
  ) THEN
    ALTER TABLE page_cache ADD COLUMN capture_id UUID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'page_cache'
      AND column_name = 'extension_version'
  ) THEN
    ALTER TABLE page_cache ADD COLUMN extension_version TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'page_cache'
      AND column_name = 'session_id'
  ) THEN
    ALTER TABLE page_cache ADD COLUMN session_id TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'page_cache'
      AND column_name = 'scroll_depth'
  ) THEN
    ALTER TABLE page_cache ADD COLUMN scroll_depth REAL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'page_cache'
      AND column_name = 'viewport_height'
  ) THEN
    ALTER TABLE page_cache ADD COLUMN viewport_height INTEGER;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'page_cache'
      AND column_name = 'document_height'
  ) THEN
    ALTER TABLE page_cache ADD COLUMN document_height INTEGER;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'page_cache'
      AND column_name = 'trigger_mode'
  ) THEN
    ALTER TABLE page_cache ADD COLUMN trigger_mode TEXT DEFAULT 'manual';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'page_cache'
      AND column_name = 'parse_version'
  ) THEN
    ALTER TABLE page_cache ADD COLUMN parse_version INTEGER;
  END IF;
END $$;

-- Add index for unparsed pages
CREATE INDEX IF NOT EXISTS idx_page_cache_unparsed ON page_cache(parsed) WHERE parsed = false;
CREATE INDEX IF NOT EXISTS idx_page_cache_url_created ON page_cache(url, created_at DESC);

-- ===========================================================
-- Extension tokens table
-- ===========================================================
CREATE TABLE IF NOT EXISTS extension_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token_hash TEXT NOT NULL UNIQUE,
  extension_id TEXT NOT NULL UNIQUE,
  display_prefix TEXT NOT NULL,
  user_agent TEXT,
  is_revoked BOOLEAN DEFAULT FALSE,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc()
);

CREATE INDEX IF NOT EXISTS idx_extension_tokens_hash ON extension_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_extension_tokens_ext_id ON extension_tokens(extension_id);

-- ===========================================================
-- Extension settings table
-- ===========================================================
CREATE TABLE IF NOT EXISTS extension_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  extension_id TEXT NOT NULL REFERENCES extension_tokens(extension_id) ON DELETE CASCADE,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc(),
  UNIQUE(extension_id)
);

-- Seed initial selector configs for 6 LinkedIn page types
-- Using the JSONB selectors_json approach for the parser engine
INSERT INTO selector_configs (page_type, selector_name, css_selector, fallback_selectors, extraction_method, is_active, version, selectors_json, heuristics, created_by, notes)
VALUES
-- PROFILE selectors
('PROFILE', 'full_config', 'h1.text-heading-xlarge', '{}', 'json', true, 1,
  '{
    "name": {"name": "Full Name", "selectors": ["h1.text-heading-xlarge", ".pv-text-details__left-panel h1", "[data-anonymize=''person-name'']", ".top-card-layout__title"], "transform": "trim"},
    "headline": {"name": "Headline", "selectors": [".text-body-medium.break-words", ".pv-text-details__left-panel .text-body-medium", "[data-anonymize=''headline'']"], "transform": "trim"},
    "location": {"name": "Location", "selectors": [".text-body-small.inline.t-black--light.break-words", ".pv-text-details__left-panel span.text-body-small", "[data-anonymize=''location'']"], "transform": "trim"},
    "about": {"name": "About Section", "selectors": ["#about ~ div .inline-show-more-text span[aria-hidden=''true'']", ".pv-shared-text-with-see-more span.visually-hidden", "section.pv-about-section .pv-about__summary-text"], "transform": "trim"},
    "experience": {"name": "Experience Entries", "selectors": ["#experience ~ div .pvs-list__paged-list-wrapper > li", ".experience-section .pv-profile-section__list-item", "#experience + .pvs-list__outer-container li.artdeco-list__item"], "multiple": true},
    "education": {"name": "Education Entries", "selectors": ["#education ~ div .pvs-list__paged-list-wrapper > li", ".education-section .pv-profile-section__list-item"], "multiple": true},
    "skills": {"name": "Skills", "selectors": ["#skills ~ div .pvs-list__paged-list-wrapper > li span.mr1.t-bold span[aria-hidden=''true'']", ".pv-skill-category-entity__name-text"], "multiple": true, "transform": "trim"},
    "connectionsCount": {"name": "Connections Count", "selectors": [".pv-top-card--list li:last-child span.t-bold", "a[href*=''/detail/contact-info''] span.t-bold", ".pv-text-details__right-panel span.t-bold"], "transform": "parseConnectionCount"},
    "profileImageUrl": {"name": "Profile Image", "selectors": [".pv-top-card-profile-picture__image", "img.presence-entity__image", ".profile-photo-edit__preview"], "attribute": "src"}
  }'::jsonb,
  '[{"field": "connectionsCount", "pattern": "([\\d,]+)\\+?\\s*connections?", "flags": "i", "captureGroup": 1, "sourceField": "connectionsCount"}]'::jsonb,
  'system', 'Initial LinkedIn PROFILE selectors v1'),

-- SEARCH_PEOPLE selectors
('SEARCH_PEOPLE', 'full_config', '.search-results-container', '{}', 'json', true, 1,
  '{
    "resultItem": {"name": "Search Result Item", "selectors": [".reusable-search__result-container", "li.search-result", ".entity-result"], "multiple": true},
    "resultName": {"name": "Result Name", "selectors": [".entity-result__title-text a span[aria-hidden=''true'']", ".search-result__title a", "span.entity-result__title-text span[dir=''ltr''] span[aria-hidden=''true'']"], "transform": "trim"},
    "resultHeadline": {"name": "Result Headline", "selectors": [".entity-result__primary-subtitle", ".search-result__truncate .subline-level-1", ".entity-result__summary"], "transform": "trim"},
    "resultProfileUrl": {"name": "Result Profile URL", "selectors": [".entity-result__title-text a", ".search-result__title a", "a.app-aware-link[href*=''/in/'']"], "attribute": "href"},
    "resultLocation": {"name": "Result Location", "selectors": [".entity-result__secondary-subtitle", ".subline-level-2"], "transform": "trim"},
    "totalResults": {"name": "Total Results", "selectors": [".search-results-container h2", ".search-results__total", ".artdeco-pill__text--selected"], "transform": "trim"}
  }'::jsonb,
  '[]'::jsonb,
  'system', 'Initial LinkedIn SEARCH_PEOPLE selectors v1'),

-- FEED selectors
('FEED', 'full_config', '.feed-shared-update-v2', '{}', 'json', true, 1,
  '{
    "postItem": {"name": "Feed Post", "selectors": [".feed-shared-update-v2", "div[data-urn^=''urn:li:activity'']", ".occludable-update"], "multiple": true},
    "authorName": {"name": "Post Author", "selectors": [".update-components-actor__name span[aria-hidden=''true'']", ".feed-shared-actor__name span", ".update-components-actor__title span[dir=''ltr''] span[aria-hidden=''true'']"], "transform": "trim"},
    "authorHeadline": {"name": "Author Headline", "selectors": [".update-components-actor__description span[aria-hidden=''true'']", ".feed-shared-actor__description"], "transform": "trim"},
    "postContent": {"name": "Post Content", "selectors": [".feed-shared-update-v2__description span[dir=''ltr'']", ".update-components-text span.break-words", ".feed-shared-text span[aria-hidden=''true'']"], "transform": "trim"},
    "likeCount": {"name": "Like Count", "selectors": [".social-details-social-counts__reactions-count", "button[aria-label*=''reaction''] span", ".social-details-social-counts__social-proof-fallback-number"], "transform": "parseInt"},
    "commentCount": {"name": "Comment Count", "selectors": ["button[aria-label*=''comment''] span", ".social-details-social-counts__comments"], "transform": "parseInt"}
  }'::jsonb,
  '[]'::jsonb,
  'system', 'Initial LinkedIn FEED selectors v1'),

-- COMPANY selectors
('COMPANY', 'full_config', '.org-top-card', '{}', 'json', true, 1,
  '{
    "companyName": {"name": "Company Name", "selectors": ["h1.org-top-card-summary__title", ".top-card-layout__title", "h1[data-anonymize=''company-name'']"], "transform": "trim"},
    "industry": {"name": "Industry", "selectors": [".org-top-card-summary-info-list__info-item:first-child", ".top-card-layout__first-subline", ".org-top-card-summary__industry"], "transform": "trim"},
    "companySize": {"name": "Company Size", "selectors": [".org-about-company-module__company-size-definition-text", ".org-top-card-summary-info-list__info-item:nth-child(2)", ".org-about-module__company-size-text"], "transform": "trim"},
    "headquarters": {"name": "Headquarters", "selectors": [".org-about-module__headquarters", ".org-top-card-summary-info-list__info-item:nth-child(3)"], "transform": "trim"},
    "about": {"name": "About", "selectors": [".org-about-us-organization-description__text p", "section.org-about-module p", ".org-page-details__definition-text"], "transform": "trim"},
    "website": {"name": "Website", "selectors": [".org-about-us-company-module__website a", "a.org-about-module__link", ".link-without-visited-state"], "attribute": "href"},
    "followerCount": {"name": "Follower Count", "selectors": [".org-top-card-summary-info-list__info-item.t-normal span", ".org-top-card-primary-actions__followers"], "transform": "parseInt"},
    "specialties": {"name": "Specialties", "selectors": [".org-about-module__specialities dd", ".org-page-details__specialities-text"], "transform": "trim"}
  }'::jsonb,
  '[]'::jsonb,
  'system', 'Initial LinkedIn COMPANY selectors v1'),

-- CONNECTIONS selectors
('CONNECTIONS', 'full_config', '.mn-connections', '{}', 'json', true, 1,
  '{
    "connectionItem": {"name": "Connection Item", "selectors": [".mn-connection-card", "li.mn-connections__card", ".reusable-search__result-container"], "multiple": true},
    "connectionName": {"name": "Connection Name", "selectors": [".mn-connection-card__name", ".mn-connection-card__details a span:first-child", ".entity-result__title-text a span[aria-hidden=''true'']"], "transform": "trim"},
    "connectionHeadline": {"name": "Connection Headline", "selectors": [".mn-connection-card__occupation", ".mn-connection-card__details .t-14", ".entity-result__primary-subtitle"], "transform": "trim"},
    "connectionProfileUrl": {"name": "Connection URL", "selectors": [".mn-connection-card__link", ".mn-connection-card a[href*=''/in/'']", ".entity-result__title-text a"], "attribute": "href"},
    "connectedDate": {"name": "Connected Date", "selectors": [".mn-connection-card__connected-date time", ".time-badge span", ".mn-connection-card time"], "transform": "trim"}
  }'::jsonb,
  '[]'::jsonb,
  'system', 'Initial LinkedIn CONNECTIONS selectors v1'),

-- MESSAGES selectors
('MESSAGES', 'full_config', '.msg-conversations-container', '{}', 'json', true, 1,
  '{
    "conversationItem": {"name": "Conversation", "selectors": [".msg-conversation-listitem", "li.msg-conversations-container__convo-item", ".msg-conversation-card"], "multiple": true},
    "participantName": {"name": "Participant Name", "selectors": [".msg-conversation-listitem__participant-names", ".msg-conversation-card__participant-names", "h3.msg-conversation-listitem__title"], "transform": "trim"},
    "lastMessage": {"name": "Last Message", "selectors": [".msg-conversation-card__message-snippet", ".msg-conversation-listitem__message-snippet p", ".msg-conversation-card__message-snippet-body"], "transform": "trim"},
    "timestamp": {"name": "Timestamp", "selectors": [".msg-conversation-card__time-stamp", ".msg-conversation-listitem__time-stamp", "time.msg-conversation-card__time-stamp"], "transform": "trim"},
    "unreadIndicator": {"name": "Unread Indicator", "selectors": [".msg-conversation-card__unread-count", ".notification-badge--count", ".msg-conversation-listitem--unread"], "transform": "trim"}
  }'::jsonb,
  '[]'::jsonb,
  'system', 'Initial LinkedIn MESSAGES selectors v1')
ON CONFLICT (page_type, selector_name, version) DO NOTHING;
