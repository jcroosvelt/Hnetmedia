-- ════════════════════════════════════════════════════════════════
-- HNet Media — migration 0009 : « article à approuver »
--  • articles.review_requested_at : date à laquelle l'auteur a demandé la publication (NULL = pas de demande) ;
--  • articles.review_reminded_at  : rappel push envoyé aux approbateurs (un seul).
-- Ajout seulement : aucune donnée existante n'est modifiée ni supprimée.
-- ════════════════════════════════════════════════════════════════

ALTER TABLE articles
  ADD COLUMN review_requested_at timestamptz,
  ADD COLUMN review_reminded_at  timestamptz;
CREATE INDEX articles_review_idx ON articles (review_requested_at) WHERE review_requested_at IS NOT NULL;
