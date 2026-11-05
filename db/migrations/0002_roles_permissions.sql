-- ════════════════════════════════════════════════════════════════
-- HNet Media — migration 0002 : rôles et permissions (moindre privilège)
-- Données de configuration réelles, pas du contenu.
-- ════════════════════════════════════════════════════════════════

INSERT INTO roles (code, label, description) VALUES
  ('administrateur',    'Administrateur',     'Gestion technique complète : comptes, réglages, suppression.'),
  ('redacteur_en_chef', 'Rédacteur en chef',  'Valide, programme, publie et archive ; corrections ; auteurs ; messages.'),
  ('editeur',           'Éditeur',            'Relit et édite tous les articles, traductions, médias et rubriques ; ne publie pas.'),
  ('journaliste',       'Journaliste',        'Rédige et modifie ses propres articles ; consulte les statistiques.'),
  ('contributeur',      'Contributeur',       'Propose des brouillons sur ses propres articles uniquement.'),
  ('commercial',        'Commercial',         'Partenaires et mention « sponsorisé » ; aucun accès au contenu éditorial.');

INSERT INTO permissions (code, description) VALUES
  ('article.create',     'Créer un brouillon'),
  ('article.edit_own',   'Modifier ses propres articles non publiés'),
  ('article.edit_any',   'Modifier n''importe quel article'),
  ('article.publish',    'Publier, programmer ou dépublier un article'),
  ('article.archive',    'Archiver un article'),
  ('article.delete',     'Supprimer définitivement un article'),
  ('article.sponsor',    'Marquer ou retirer la mention « sponsorisé »'),
  ('translation.edit',   'Modifier et valider les traductions de tout article'),
  ('correction.manage',  'Publier une correction'),
  ('media.upload',       'Téléverser un média'),
  ('media.manage',       'Modifier ou supprimer les médias'),
  ('taxonomy.manage',    'Gérer rubriques et tags'),
  ('author.manage',      'Gérer les fiches auteurs'),
  ('partner.manage',     'Gérer les partenaires'),
  ('job.manage',         'Gérer les offres d''emploi'),
  ('contact.read',       'Lire les messages de contact'),
  ('contact.manage',     'Traiter les messages de contact'),
  ('subscriber.read',    'Consulter la liste des abonnés'),
  ('subscriber.export',  'Exporter la liste des abonnés'),
  ('stats.read',         'Consulter les statistiques d''audience'),
  ('user.manage',        'Gérer les comptes et les rôles'),
  ('settings.manage',    'Modifier les réglages du site'),
  ('audit.read',         'Consulter le journal d''administration');

-- Administrateur : toutes les permissions
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p WHERE r.code = 'administrateur';

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, x.perm FROM roles r
JOIN (VALUES
  ('redacteur_en_chef', 'article.create'), ('redacteur_en_chef', 'article.edit_own'),
  ('redacteur_en_chef', 'article.edit_any'), ('redacteur_en_chef', 'article.publish'),
  ('redacteur_en_chef', 'article.archive'), ('redacteur_en_chef', 'translation.edit'),
  ('redacteur_en_chef', 'correction.manage'), ('redacteur_en_chef', 'media.upload'),
  ('redacteur_en_chef', 'media.manage'), ('redacteur_en_chef', 'taxonomy.manage'),
  ('redacteur_en_chef', 'author.manage'), ('redacteur_en_chef', 'job.manage'),
  ('redacteur_en_chef', 'contact.read'), ('redacteur_en_chef', 'contact.manage'),
  ('redacteur_en_chef', 'stats.read'),

  ('editeur', 'article.create'), ('editeur', 'article.edit_own'), ('editeur', 'article.edit_any'),
  ('editeur', 'translation.edit'), ('editeur', 'media.upload'), ('editeur', 'media.manage'),
  ('editeur', 'taxonomy.manage'), ('editeur', 'stats.read'),

  ('journaliste', 'article.create'), ('journaliste', 'article.edit_own'),
  ('journaliste', 'media.upload'), ('journaliste', 'stats.read'),

  ('contributeur', 'article.create'), ('contributeur', 'article.edit_own'),
  ('contributeur', 'media.upload'),

  ('commercial', 'partner.manage'), ('commercial', 'article.sponsor'),
  ('commercial', 'contact.read'), ('commercial', 'stats.read')
) AS x(role, perm) ON x.role = r.code;
