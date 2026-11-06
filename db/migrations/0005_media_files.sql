-- ════════════════════════════════════════════════════════════════
-- HNet Media — migration 0005 : fichiers d'images téléversés
-- Les octets de chaque image (déjà réduite et compressée par le navigateur) sont conservés dans Neon,
-- sans service supplémentaire. La ligne « media » garde les métadonnées ; l'image est servie sur
-- /media/<id> (adresse stable : un changement de stockage ne touchera pas aux articles).
-- ════════════════════════════════════════════════════════════════

CREATE TABLE media_files (
  media_id uuid PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
  data     bytea NOT NULL
);

CREATE INDEX media_created_idx ON media (created_at DESC);
