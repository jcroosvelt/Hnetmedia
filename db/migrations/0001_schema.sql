-- ════════════════════════════════════════════════════════════════
-- HNet Media — migration 0001 : schéma initial
-- Appliquer avec : node db/migrate.js   (jamais à la main sur main)
-- ════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_bytes()

-- ── Types énumérés ──────────────────────────────────────────────
CREATE TYPE article_status AS ENUM ('brouillon', 'programme', 'publie', 'archive');
CREATE TYPE article_type   AS ENUM ('information', 'opinion', 'tribune', 'editorial', 'analyse');
CREATE TYPE lang_code      AS ENUM ('fr', 'en', 'ht');
CREATE TYPE subscriber_status AS ENUM ('en_attente', 'confirme', 'desinscrit');
CREATE TYPE contact_status AS ENUM ('nouveau', 'lu', 'traite', 'spam');
CREATE TYPE job_status     AS ENUM ('brouillon', 'ouvert', 'ferme');

-- ── Mise à jour automatique de updated_at ───────────────────────
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ════════════════ COMPTES, RÔLES, PERMISSIONS ════════════════════
CREATE TABLE roles (
  id          smallserial PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  label       text NOT NULL,
  description text
);

CREATE TABLE permissions (
  code        text PRIMARY KEY,
  description text NOT NULL
);

CREATE TABLE role_permissions (
  role_id         smallint NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_code text     NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               citext NOT NULL UNIQUE,
  display_name        text NOT NULL,
  password_hash       text,                       -- jamais de mot de passe en clair
  role_id             smallint NOT NULL REFERENCES roles(id),
  active              boolean NOT NULL DEFAULT true,
  failed_logins       integer NOT NULL DEFAULT 0,
  locked_until        timestamptz,
  last_login_at       timestamptz,
  password_changed_at timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Sessions : on ne stocke que l'empreinte SHA-256 du jeton du cookie.
CREATE TABLE sessions (
  token_hash   text PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_secret  text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  ip_hash      text,
  user_agent   text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- ════════════════ CONTENU ÉDITORIAL ══════════════════════════════
CREATE TABLE categories (
  slug        text PRIMARY KEY CHECK (slug ~ '^[a-z0-9-]+$'),
  label       text NOT NULL,
  icon        text,
  color       text CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$'),
  tag_class   text,
  description text,
  position    smallint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER categories_updated_at BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE authors (
  id          text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]+$'),
  name        text NOT NULL,
  role        text,
  bio         text,
  photo_url   text,
  social      jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_id     uuid UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER authors_updated_at BEFORE UPDATE ON authors FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE media (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url         text NOT NULL,
  alt         text NOT NULL DEFAULT '',
  caption     text,
  credit      text,
  mime_type   text,
  width       integer,
  height      integer,
  size_bytes  bigint,
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE articles (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  slug          text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
  status        article_status NOT NULL DEFAULT 'brouillon',
  type          article_type   NOT NULL DEFAULT 'information',
  sponsored     boolean NOT NULL DEFAULT false,
  featured      boolean NOT NULL DEFAULT false,
  urgent        boolean NOT NULL DEFAULT false,
  recommended   boolean NOT NULL DEFAULT false,
  category_slug text REFERENCES categories(slug) ON UPDATE CASCADE,
  subcategory   text,
  author_id     text REFERENCES authors(id) ON UPDATE CASCADE ON DELETE SET NULL,
  author_name   text,                -- signature libre si pas de fiche auteur
  original_lang lang_code NOT NULL DEFAULT 'fr',
  main_media_id uuid REFERENCES media(id) ON DELETE SET NULL,
  reading_time  smallint,
  published_at  timestamptz,         -- programme : date future ; publie : date passée
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT articles_date_si_diffuse
    CHECK (status NOT IN ('programme', 'publie') OR published_at IS NOT NULL)
);
CREATE TRIGGER articles_updated_at BEFORE UPDATE ON articles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX articles_public_idx   ON articles (published_at DESC) WHERE status = 'publie';
CREATE INDEX articles_category_idx ON articles (category_slug, published_at DESC);
CREATE INDEX articles_author_idx   ON articles (author_id);

-- Textes par langue. Une traduction n'est publiée que si reviewed = true
-- (aucune traduction automatique non relue).
CREATE TABLE article_translations (
  article_id      text NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  lang            lang_code NOT NULL,
  kicker          text,
  title           text NOT NULL,
  excerpt         text,
  content         text NOT NULL DEFAULT '',
  seo_title       text,
  seo_description text,
  og_image_url    text,
  reviewed        boolean NOT NULL DEFAULT false,
  translated_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (article_id, lang)
);
CREATE TRIGGER article_translations_updated_at BEFORE UPDATE ON article_translations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Galerie (l'image principale est articles.main_media_id)
CREATE TABLE article_media (
  article_id text NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  media_id   uuid NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  position   smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (article_id, media_id)
);

CREATE TABLE tags (
  slug       text PRIMARY KEY CHECK (slug ~ '^[a-z0-9-]+$'),
  label      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE article_tags (
  article_id text NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  tag_slug   text NOT NULL REFERENCES tags(slug) ON UPDATE CASCADE ON DELETE CASCADE,
  PRIMARY KEY (article_id, tag_slug)
);
CREATE INDEX article_tags_tag_idx ON article_tags (tag_slug);

CREATE TABLE article_sources (
  id          bigserial PRIMARY KEY,
  article_id  text NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  position    smallint NOT NULL DEFAULT 0,
  name        text NOT NULL,
  url         text,
  description text
);
CREATE INDEX article_sources_article_idx ON article_sources (article_id, position);

-- Corrections publiques (historique conservé, jamais effacé silencieusement)
CREATE TABLE corrections (
  id           bigserial PRIMARY KEY,
  article_id   text NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  text         text NOT NULL,
  corrected_at timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX corrections_article_idx ON corrections (article_id, corrected_at DESC);

-- ════════════════ PUBLIC : NEWSLETTER, CONTACT ═══════════════════
CREATE TABLE subscribers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               citext NOT NULL UNIQUE,
  lang                lang_code NOT NULL DEFAULT 'fr',
  status              subscriber_status NOT NULL DEFAULT 'en_attente',
  consent_text        text NOT NULL,          -- texte exact accepté
  consent_at          timestamptz NOT NULL DEFAULT now(),
  consent_ip_hash     text,                   -- empreinte, jamais l'IP en clair
  confirm_token_hash  text UNIQUE,            -- SHA-256 du jeton envoyé par e-mail
  confirm_expires_at  timestamptz,
  confirmed_at        timestamptz,
  unsubscribe_token   text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  unsubscribed_at     timestamptz,
  source              text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER subscribers_updated_at BEFORE UPDATE ON subscribers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX subscribers_status_idx ON subscribers (status);

CREATE TABLE contact_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  email      citext NOT NULL,
  category   text NOT NULL,
  subject    text,
  message    text NOT NULL,
  status     contact_status NOT NULL DEFAULT 'nouveau',
  ip_hash    text,
  user_agent text,
  handled_by uuid REFERENCES users(id) ON DELETE SET NULL,
  handled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contact_messages_status_idx ON contact_messages (status, created_at DESC);

-- ════════════════ SITE : POSTES, PARTENAIRES, RÉGLAGES ═══════════
CREATE TABLE jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
  title        text NOT NULL,
  contract     text,
  location     text,
  description  text NOT NULL,
  apply_url    text,
  apply_email  citext,
  status       job_status NOT NULL DEFAULT 'brouillon',
  published_at timestamptz,
  closes_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER jobs_updated_at BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE partners (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  url           text,
  logo_media_id uuid REFERENCES media(id) ON DELETE SET NULL,
  description   text,
  kind          text NOT NULL DEFAULT 'partenaire' CHECK (kind IN ('partenaire', 'annonceur', 'institution')),
  active        boolean NOT NULL DEFAULT true,
  position      smallint NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER partners_updated_at BEFORE UPDATE ON partners FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Réglages du site (équivalent de content/site-settings.json)
CREATE TABLE site_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER site_settings_updated_at BEFORE UPDATE ON site_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ════════════════ MESURE D'AUDIENCE (sans données personnelles) ══
-- Compteur agrégé par heure : aucune IP, aucun identifiant visiteur.
CREATE TABLE page_views (
  path       text NOT NULL,
  bucket     timestamptz NOT NULL,     -- date_trunc('hour', now())
  article_id text REFERENCES articles(id) ON DELETE CASCADE,
  views      integer NOT NULL DEFAULT 0,
  PRIMARY KEY (path, bucket)
);
CREATE INDEX page_views_article_idx ON page_views (article_id, bucket DESC) WHERE article_id IS NOT NULL;
CREATE INDEX page_views_bucket_idx  ON page_views (bucket DESC);

-- ════════════════ SÉCURITÉ TECHNIQUE ═════════════════════════════
-- Rate limiting par fenêtre fixe (clé = action + empreinte IP)
CREATE TABLE rate_limits (
  key          text NOT NULL,
  window_start timestamptz NOT NULL,
  hits         integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
CREATE INDEX rate_limits_window_idx ON rate_limits (window_start);

-- Journal des actions d'administration
CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  action     text NOT NULL,
  entity     text,
  entity_id  text,
  details    jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);
