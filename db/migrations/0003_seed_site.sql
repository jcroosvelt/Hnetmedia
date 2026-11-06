-- ════════════════════════════════════════════════════════════════
-- HNet Media — migration 0003 : données de base du site
-- Les 8 rubriques et les réglages d'identité du site (issus des anciens fichiers
-- content/*.json, désormais supprimés). Idempotente : ne modifie jamais une ligne
-- déjà présente (une rubrique ou un réglage modifié ensuite dans /admin est conservé).
-- Aucun faux contenu : ni auteur, ni article, ni partenaire, ni offre.
-- ════════════════════════════════════════════════════════════════

INSERT INTO categories (slug, label, icon, color, tag_class, description, position) VALUES
  ('politique', 'Politique', '🏛️', '#FF6B00', 'tag', 'Institutions, vie parlementaire, élections et décisions publiques.', 0),
  ('monde', 'Monde', '🌍', '#DC2626', 'tag tag-monde', 'Relations internationales, conflits, diplomatie et actualité des continents.', 1),
  ('economie', 'Économie', '📈', '#D97706', 'tag tag-economie', 'Marchés, entreprises, emploi et grandes tendances économiques.', 2),
  ('sport', 'Sport', '⚽', '#16A34A', 'tag tag-sport', 'Résultats, compétitions, transferts et portraits d''athlètes.', 3),
  ('culture', 'Culture', '🎭', '#7C3AED', 'tag tag-culture', 'Cinéma, musique, littérature, arts et sorties culturelles.', 4),
  ('tech', 'Tech', '💻', '#0284C7', 'tag tag-tech', 'Intelligence artificielle, innovations, startups et numérique.', 5),
  ('sante', 'Santé', '🩺', '#059669', 'tag tag-sante', 'Recherche médicale, prévention, système de santé et bien-être.', 6),
  ('opinions', 'Opinions & Analyses', '✍️', '#4B5563', 'tag tag-opinions', 'Tribunes, éditoriaux et analyses signés par nos contributeurs.', 7)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO site_settings (key, value) VALUES
  ('siteName', '"HNet Media"'::jsonb),
  ('baseUrl', '"https://www.hnetmedia.com"'::jsonb),
  ('tagline', '"L''actualité sans frontières"'::jsonb),
  ('description', '"HNet Media : l''actualité Politique, Monde, Économie, Sport, Culture, Tech et Santé. Un journalisme indépendant, rigoureux et engagé au service du citoyen."'::jsonb),
  ('contactEmail', '"redaction@hnetmedia.com"'::jsonb),
  ('social', '{"twitter":"","facebook":"","linkedin":"","youtube":"","instagram":""}'::jsonb),
  ('newsletterStats', 'null'::jsonb),
  ('contactCategories', '["Rédaction","Correction","Publicité","Partenariat","Recrutement","Autre"]'::jsonb)
ON CONFLICT (key) DO NOTHING;
