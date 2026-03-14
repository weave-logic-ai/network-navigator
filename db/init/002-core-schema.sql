-- 002-core-schema.sql
-- Core tables: contacts, companies, edges, clusters, cluster_memberships

-- Companies (must be created before contacts due to FK)
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  domain TEXT,
  industry TEXT,
  size_range TEXT,
  linkedin_url TEXT,
  description TEXT,
  headquarters TEXT,
  founded_year INTEGER,
  employee_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc()
);

-- Contacts
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  linkedin_url TEXT UNIQUE NOT NULL,
  first_name TEXT,
  last_name TEXT,
  full_name TEXT,
  headline TEXT,
  title TEXT,
  current_company TEXT,
  current_company_id UUID REFERENCES companies(id),
  location TEXT,
  about TEXT,
  email TEXT,
  phone TEXT,
  connections_count INTEGER,
  degree INTEGER DEFAULT 1,
  profile_image_url TEXT,
  discovered_via TEXT[] DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  notes TEXT,
  is_archived BOOLEAN DEFAULT FALSE,
  dedup_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc()
);

-- Edges (relationships between entities)
CREATE TABLE edges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  target_contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  target_company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  edge_type TEXT NOT NULL,
  weight REAL DEFAULT 1.0,
  properties JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  CONSTRAINT edge_has_target CHECK (target_contact_id IS NOT NULL OR target_company_id IS NOT NULL)
);

-- Clusters
CREATE TABLE clusters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  label TEXT NOT NULL,
  description TEXT,
  algorithm TEXT NOT NULL DEFAULT 'spectral',
  member_count INTEGER DEFAULT 0,
  centroid RUVECTOR(384),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc()
);

-- Cluster memberships
CREATE TABLE cluster_memberships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  cluster_id UUID NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  membership_score REAL DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  UNIQUE(contact_id, cluster_id)
);

-- Indexes
CREATE INDEX idx_contacts_dedup_hash ON contacts(dedup_hash);
CREATE INDEX idx_contacts_tags ON contacts USING GIN(tags);
CREATE INDEX idx_contacts_current_company_id ON contacts(current_company_id);
CREATE INDEX idx_contacts_is_archived ON contacts(is_archived);

CREATE INDEX idx_edges_source_contact_id ON edges(source_contact_id);
CREATE INDEX idx_edges_target_contact_id ON edges(target_contact_id);
CREATE INDEX idx_edges_target_company_id ON edges(target_company_id);
CREATE INDEX idx_edges_edge_type ON edges(edge_type);

-- updated_at triggers
CREATE TRIGGER trg_contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_clusters_updated_at
  BEFORE UPDATE ON clusters
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
