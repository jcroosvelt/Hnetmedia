-- ════════════════════════════════════════════════════════════════
-- HNet Media — migration 0010 : commentaires des lecteurs
--  • comments : un commentaire (ou une réponse, un seul niveau) sur un article ;
--    tout commentaire arrive « en_attente » et n'est public qu'une fois « approuve » par la rédaction ;
--  • permission comment.moderate (administrateur, rédacteur en chef, éditeur).
-- L'adresse e-mail (facultative) n'est jamais affichée ; l'IP n'est stockée que sous forme d'empreinte.
-- Ajout seulement : aucune donnée existante n'est modifiée ni supprimée.
-- ════════════════════════════════════════════════════════════════

CREATE TYPE comment_status AS ENUM ('en_attente', 'approuve', 'refuse', 'spam');

CREATE TABLE comments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id       text NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  parent_id        uuid REFERENCES comments(id) ON DELETE CASCADE,
  name             text NOT NULL,
  email            citext,
  body             text NOT NULL,
  lang             lang_code NOT NULL DEFAULT 'fr',
  status           comment_status NOT NULL DEFAULT 'en_attente',
  is_staff         boolean NOT NULL DEFAULT false,      -- réponse publiée par la rédaction
  ip_hash          text,
  user_agent       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  moderated_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  moderated_at     timestamptz,
  push_reminded_at timestamptz
);
CREATE INDEX comments_article_idx ON comments (article_id, status, created_at);
CREATE INDEX comments_status_idx  ON comments (status, created_at DESC);

INSERT INTO permissions (code, description) VALUES ('comment.moderate', 'Modérer les commentaires des lecteurs');
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'comment.moderate' FROM roles r WHERE r.code IN ('administrateur', 'redacteur_en_chef', 'editeur');
