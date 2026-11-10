-- ════════════════════════════════════════════════════════════════
-- HNet Media — migration 0006 : pages fixes modifiables depuis /admin
-- Une ligne par page modifiée (À propos, Charte éditoriale, Publicité, CGU, Confidentialité, Cookies).
-- Sans ligne, le site garde le texte d'origine (fichiers du dossier pages/). Le contenu est du HTML
-- nettoyé côté serveur (liste blanche) ; « supprimer la ligne » = revenir au texte d'origine.
-- ════════════════════════════════════════════════════════════════

CREATE TABLE site_pages (
  slug        text PRIMARY KEY CHECK (slug ~ '^[a-z0-9-]+$'),
  title       text NOT NULL,
  description text,
  content     text NOT NULL,
  updated_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
