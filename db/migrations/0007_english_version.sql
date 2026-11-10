-- ════════════════════════════════════════════════════════════════
-- HNet Media — migration 0007 : version anglaise du site
--  • rubriques : libellé et description en anglais (modifiables dans /admin › Rubriques) ;
--  • pages fixes : une version par langue (clé = page + langue) ;
-- Le créole n'est plus proposé (la valeur « ht » reste dans le type lang_code, simplement inutilisée).
-- Les traductions d'articles existent déjà (article_translations, validées par un humain avant publication).
-- ════════════════════════════════════════════════════════════════

ALTER TABLE categories
  ADD COLUMN label_en       text,
  ADD COLUMN description_en text;

-- Textes de départ en anglais (modifiables ensuite dans /admin ; une valeur déjà saisie n'est jamais écrasée).
UPDATE categories SET label_en = v.label_en, description_en = v.description_en
FROM (VALUES
  ('politique', 'Politics', 'Institutions, parliamentary life, elections and public decisions.'),
  ('monde', 'World', 'International relations, conflicts, diplomacy and news from every continent.'),
  ('economie', 'Economy', 'Markets, business, jobs and the major economic trends.'),
  ('sport', 'Sport', 'Results, competitions, transfers and athlete profiles.'),
  ('culture', 'Culture', 'Film, music, literature, the arts and cultural events.'),
  ('tech', 'Tech', 'Artificial intelligence, innovation, startups and digital life.'),
  ('sante', 'Health', 'Medical research, prevention, the health system and well-being.'),
  ('opinions', 'Opinions & Analysis', 'Op-eds, editorials and analysis signed by our contributors.')
) AS v(slug, label_en, description_en)
WHERE categories.slug = v.slug AND categories.label_en IS NULL;

ALTER TABLE site_pages DROP CONSTRAINT site_pages_pkey;
ALTER TABLE site_pages ADD COLUMN lang text NOT NULL DEFAULT 'fr' CHECK (lang IN ('fr', 'en'));
ALTER TABLE site_pages ADD PRIMARY KEY (slug, lang);
