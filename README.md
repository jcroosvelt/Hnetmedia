# HNet Media

Média en ligne « L'actualité sans frontières ». Site statique multi-pages généré par `build.js`
à partir de **Neon (PostgreSQL)**, hébergé sur **Vercel**.

```
/admin (équipe)  ──▶  Neon  ──▶  node build.js  ──▶  dist/  ──▶  Vercel
```

- **Rédaction** : tout se fait sur `/admin` (articles, traductions, corrections, messages, abonnés,
  statistiques, comptes). Aucun fichier de contenu n'est à modifier dans le dépôt.
- **Déploiement** : chaque modification poussée sur la branche `main` de GitHub déclenche un déploiement
  Vercel. Le build lit Neon ; il échoue (et l'ancienne version reste en ligne) si la base est injoignable.
- **Fonctions** (`api/`) : contact, newsletter, compteur de vues, administration. Détails dans `CLAUDE.md`.

## En local

```
cp .env.example .env.local      # renseigner DATABASE_URL (branche Neon de test)
npm install
npm run db:migrate              # applique db/migrations/*.sql
node build.js && node serve.js 8000
```

Tests : `npm test` (API) et `npm run test:browser` (interface /admin), sur un PostgreSQL **local**,
jamais sur Neon.

## Variables d'environnement

Voir `.env.example`. Les valeurs réelles ne vont **jamais** dans le code ni dans git : uniquement dans
Vercel (Settings → Environment Variables) et dans `.env.local` (ignoré par git).

## Ce qui n'est pas encore actif

| Fonction | État |
|---|---|
| Formulaire de contact | **Actif** : le message est enregistré (`/admin › Messages`). Alerte par e-mail à l'équipe : facultative (Resend) |
| Newsletter | API prête, **non branchée** au site : exige un nom de domaine vérifié chez Resend (pas encore acheté) |
| Mise à jour du site à chaque publication | Prête côté code ; il reste à créer le Deploy Hook Vercel (`VERCEL_DEPLOY_HOOK_URL`) |
| Publication à heure programmée | Pas de déclencheur horaire : l'article paraît au premier déploiement après sa date |
| Images | **Actif** : téléversement depuis l'appareil (réduit automatiquement), médiathèque, ou adresse https ; stockées dans Neon. Pas encore de suppression d'images |
| Contenu éditorial en anglais / kreyòl | Stocké et relu dans l'éditeur, **pas encore publié** sur le site |
