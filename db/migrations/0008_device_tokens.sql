-- ════════════════════════════════════════════════════════════════
-- HNet Media — migration 0008 : notifications push de l'application Android
--  • device_tokens : jetons Firebase (FCM) des téléphones de l'équipe, un par appareil ;
--  • contact_messages : suivi des rappels (jamais plus de 3, au moins 2 h d'écart).
-- Ajout seulement : aucune donnée existante n'est modifiée ni supprimée.
-- ════════════════════════════════════════════════════════════════

CREATE TABLE device_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token        text NOT NULL UNIQUE,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX device_tokens_user_idx ON device_tokens (user_id);

ALTER TABLE contact_messages
  ADD COLUMN push_reminded_at timestamptz,
  ADD COLUMN push_reminders   smallint NOT NULL DEFAULT 0;
