# HNet Media — contexte projet (lu automatiquement par Claude Code)

Média en ligne « L'actualité sans frontières » (Joseph / J. Roosvelt Jean Charles, Pétion-Ville, Haïti).
Site statique multi-pages généré par `build.js` (Node) — **Phase 2 en cours** : contenu dans Neon (PostgreSQL), hébergement **Vercel** relié au dépôt GitHub `jcroosvelt/hnetmedia` : **chaque modification est commitée et poussée sur `main`**, ce qui déclenche le déploiement (pas de déploiement Vercel direct).

## Règles absolues
1. **Ne pas refaire le design.** `assets/style.css`, logo, couleurs (marine, orange, cyan), Playfair Display + Inter, header, ticker, cartes, footer : intouchables. Toute nouvelle UI réutilise les classes existantes. Pas de nouveau gradient, pas de nouvelle couleur.
2. **Base de données : Neon (PostgreSQL), projet `hnetmedia` (`holy-dawn-31853096`, région aws-us-east-1, base `hnetmedia`).**
   - **Décision du propriétaire (5 nov. 2026) : le site utilise directement la branche Neon `main`** (`br-fancy-surf-bci37es5`, production). Schéma et données de départ y sont appliqués (migrations 0001 et 0002 + import des JSON).
   - La branche `dev` (`br-wispy-dream-bcr1umhf`) reste disponible comme terrain d'essai : à utiliser pour toute migration ou opération risquée, avant de la rejouer sur `main`.
   - Comme `main` contient de vraies données : sauvegarde ou branche de secours avant toute migration.
   - Demander confirmation au propriétaire avant tout SQL destructif (`DROP`, `TRUNCATE`, `DELETE`/`UPDATE` de masse).
   - Schéma uniquement via des migrations SQL versionnées dans `/db/migrations`.
   - Secrets (`DATABASE_URL`, clés API) : uniquement dans les variables d'environnement Vercel et un `.env.local` ignoré par git. Jamais dans le code, les logs ou les commits. Ne jamais demander de mot de passe.
   - Backend = fonctions serverless Vercel (`/api`) : requêtes paramétrées, validation serveur, anti-spam, rate limiting, CSRF.
3. **Aucun faux contenu.** Pas de « Titre article », faux auteurs, faux partenaires, faux chiffres (abonnés, audience), fausses sources, faux postes. Sans donnée réelle : état vide professionnel (`emptyState()` dans build.js) ou champ administrable.
4. **Honnêteté fonctionnelle.** Une fonction n'est présentée comme active qu'une fois réellement branchée et testée de bout en bout. Tant que ce n'est pas le cas, elle reste signalée comme non connectée. Jamais de fausse confirmation.
5. Garder le projet utilisable depuis un téléphone Android (Acode) : `build.js` doit pouvoir tourner hors ligne (repli sur `content/*.json`) et `serve.js` reste sans dépendance. Les dépendances npm sont limitées au strict nécessaire côté serveur (pilote Neon).
6. Répondre et commenter en français.

## Architecture
```
Neon (main ; dev = essais)  ─┐
                   ├─node build.js──▶  dist/  ──▶  Vercel (push sur main = déploiement)
content/*.json   ─┘  (repli hors ligne)
```
- `content/` : articles, authors, categories, tags, site-settings (partners, jobs, endpoints, newsletterStats)
- `partials/header.html`, `footer.html` : design commun injecté partout
- `pages/*.html` : fragments des pages fixes (à-propos, équipe, charte, partenaires, publicité, carrières, contact, légales, plan du site, recherche, 404)
- `build.js` : génère accueil, 8 rubriques, `/article/{slug}.html`, `/auteur/{id}.html`, `/tag/{slug}.html`, pages fixes, `content/search-index.json`, `sitemap.xml`, `rss.xml`, `robots.txt`, JSON-LD (NewsArticle, BreadcrumbList, Organization, WebSite+SearchAction)
- `assets/` : `style.css`, `main.js` (date, nav active, FR/EN, partage, redirection des anciens `#/route`), `contact.js` / `newsletter.js` (`CONTACT_ENDPOINT` / `NEWSLETTER_ENDPOINT` vides), `search.js` (recherche client sur l'index)
- `admin-app/` : **espace rédaction sécurisé** servi sur `/admin` (aucun lien depuis le site, `noindex`, CSP stricte dans `vercel.json`). `index.html` + `admin.css` (variables/polices du site uniquement) + `admin.js` (interface, JS sans dépendance, DOM via textContent) + `editor.src.js` → **`editor.js` compilé et versionné** (TipTap/ProseMirror, MIT). Après toute modification de `editor.src.js` : `npm run build:editor` puis committer `editor.js`. L'ancien outil `admin/` (sans authentification) est supprimé.
- `assets/article-body.css` : typographie du corps d'article (h2-h4, listes, citations, figures, tableaux), feuille SÉPARÉE de `style.css` (qui reste intact), partagée par les pages d'article (`.article-body`) et l'éditeur (aperçu fidèle). Couleurs et polices existantes uniquement.
- `vercel.json` (build `node build.js`, sortie `dist/`, URLs propres), `.htaccess` (Apache) — Netlify n'est pas utilisé
- `serve.js` : serveur local avec URLs propres → `npm run dev` ou `node build.js && node serve.js`
- `api/` : fonctions serverless Vercel — `contact.js`, `newsletter.js` (subscribe/confirm/unsubscribe), `views.js` (compteur + plus lus/tendances), `admin.js` (auth + API d'administration), `health.js` (contrôle : base joignable ?). Réécritures dans `vercel.json`.
- `server/` : code partagé des fonctions (db, http, sécurité, rate limiting, validation, anti-spam, e-mail, auth scrypt/sessions/CSRF, articles, nettoyage HTML)
- `db/` : `migrations/*.sql`, `migrate.js`, `import-json.js`
- `test/` : `npm test` (API de bout en bout) et `npm run test:browser` (Playwright : interface /admin, mobile + ordinateur, droits par rôle) contre un PostgreSQL **local** (`TEST_PG_ADMIN_URL`, port 5433), jamais contre Neon
- Dépendances de production figées : `sanitize-html` en **2.13.1** exactement (les versions ≥ 2.14 tirent htmlparser2 12, module ESM seul : la fonction admin plante sur Vercel). Node imposé : 22.x.
- Variables d'environnement : voir `.env.example`

Statuts d'article : `brouillon` | `programme` | `publie` | `archive`. Public = `publie` ET `publishedAt` ≤ maintenant.
Types : `information` | `opinion` | `tribune` | `editorial` | `analyse` (+ `sponsored`).
`articles.json` contient 1 brouillon-modèle (non publié) : le garder comme référence de schéma.

## Dette connue (à traiter)
- **Bandeau de l'éditeur** (`admin-app/admin.js`, « le site public est encore généré depuis les fichiers du dépôt ») : à retirer dès que `build.js` lit Neon (étape 8).
- Images des articles : adresse https saisie à la main ; le téléversement (médiathèque) reste à faire.
- Pagination des rubriques : conteneur `#catPagination` et `window.__CAT_TOTAL__` présents, **aucun JS** ne pagine encore (10/page prévu).
- `newsletterStats` : conteneur `#nlStats` masqué, **aucun JS/rendu** ; ne l'afficher que si renseigné dans site-settings.
- Convention d'URL à trancher : liens du header/footer sans `.html` (`/politique`), canonical/sitemap/cartes avec `.html`. Choisir une seule forme partout.
- Liens sociaux du footer = `#` (à alimenter depuis `site-settings.social`, masquer si vide).
- `og:image` par défaut = `icon-512.png` : prévoir une vraie image 1200×630.
- Mentions légales : champs `[à renseigner]` — ne rien inventer (éditeur, hébergeur, n° d'entreprise).
- Pages `/a-propos` etc. non pilotées par JSON (texte en dur dans `pages/`).
- FR/EN : seul l'UI bascule, le contenu éditorial n'est pas traduit (bandeau honnête affiché).
- `lang` : le site est trilingue (FR/EN/Kreyòl) — le kreyòl n'est pas encore géré.

## Phase 2 (en cours — Neon + Vercel)
Remplacer la lecture JSON de `build.js` par des requêtes ; brancher contact + newsletter ; auth admin et rôles ; analytics (plus lus, tendances) ; médiathèque ; programmation réelle des articles.
