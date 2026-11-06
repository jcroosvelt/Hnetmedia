-- ════════════════════════════════════════════════════════════════
-- HNet Media — migration 0004 : « Droit de réponse » dans les types de demande du formulaire de contact
-- Le formulaire public proposait déjà « Droit de réponse » ; la liste des réglages ne le connaissait pas
-- (la validation serveur l'aurait refusé). Mise à jour UNIQUEMENT si le réglage est encore exactement
-- la liste d'origine : une liste modifiée ensuite dans /admin n'est jamais écrasée.
-- ════════════════════════════════════════════════════════════════

UPDATE site_settings
SET value = '["Rédaction","Correction","Droit de réponse","Publicité","Partenariat","Recrutement","Autre"]'::jsonb
WHERE key = 'contactCategories'
  AND value = '["Rédaction","Correction","Publicité","Partenariat","Recrutement","Autre"]'::jsonb;
