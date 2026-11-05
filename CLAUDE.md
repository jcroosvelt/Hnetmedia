# HNet Media — contexte projet (lu automatiquement par Claude Code)

Média en ligne « L'actualité sans frontières » (Joseph / J. Roosvelt Jean Charles, Pétion-Ville, Haïti).
Site statique multi-pages généré par `build.js` (Node) — **Phase 2 en cours** : contenu dans Neon (PostgreSQL), hébergement **Vercel** relié au dépôt GitHub `jcroosvelt/hnetmedia` : **chaque modification est commitée et poussée sur `main`**, ce qui déclenche le déploiement (pas de déploiement Vercel direct).

## Règles absolues
1. **Ne pas refaire le design.** `assets/style.css`, logo, couleurs (marine, orange, cyan), Playfair Display + Inter, header, ticker, cartes, footer : intouchables. Toute nouvelle UI réutilise les classes existantes. Pas de nouveau gradient, pas de nouvelle couleur.
2. **Base de données : Neon (PostgreSQL), projet `hnetmedia` (`holy-dawn-31853096`, région aws-us-east-1, base `hnetmedia`).**
   - Toujours travailler sur la branche Neon **`dev`** (`br-wispy-dream-bcr1umhf`), jamais directement sur `main` (branche de prod).
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
Neon (dev/main)  ─┐
                   ├─node build.js──▶  dist/  ──▶  Vercel (push sur main = déploiement)
content/*.json   ─┘  (repli hors ligne)
```
- `content/` : articles, authors, categories, tags, site-settings (partners, jobs, endpoints, newsletterStats)
- `partials/header.html`, `footer.html` : design commun injecté partout
- `pages/*.html` : fragments des pages fixes (à-propos, équipe, charte, partenaires, publicité, carrières, contact, légales, plan du site, recherche, 404)
- `build.js` : génère accueil, 8 rubriques, `/article/{slug}.html`, `/auteur/{id}.html`, `/tag/{slug}.html`, pages fixes, `content/search-index.json`, `sitemap.xml`, `rss.xml`, `robots.txt`, JSON-LD (NewsArticle, BreadcrumbList, Organization, WebSite+SearchAction)
- `assets/` : `style.css`, `main.js` (date, nav active, FR/EN, partage, redirection des anciens `#/route`), `contact.js` / `newsletter.js` (`CONTACT_ENDPOINT` / `NEWSLETTER_ENDPOINT` vides), `search.js` (recherche client sur l'index)
- `admin/index.html` : ancien outil local qui génère du JSON d'article — **sans authentification**, il n'est **plus copié dans `dist/`** (remplacé par l'admin sécurisé de la phase 2). `dist/content/` ne contient que `search-index.json`.
- `vercel.json` (build `node build.js`, sortie `dist/`, URLs propres), `.htaccess` (Apache) — Netlify n'est pas utilisé
- `serve.js` : serveur local avec URLs propres → `npm run dev` ou `node build.js && node serve.js`
- `api/` : fonctions serverless Vercel — `contact.js`, `newsletter.js` (subscribe/confirm/unsubscribe), `views.js` (compteur + plus lus/tendances), `admin.js` (auth + API d'administration). Réécritures dans `vercel.json`.
- `server/` : code partagé des fonctions (db, http, sécurité, rate limiting, validation, anti-spam, e-mail, auth scrypt/sessions/CSRF, articles, nettoyage HTML)
- `db/` : `migrations/*.sql`, `migrate.js`, `import-json.js`
- `test/` : tests de bout en bout des fonctions (`npm test`) contre un PostgreSQL **local** (`TEST_PG_ADMIN_URL`), jamais contre Neon
- Variables d'environnement : voir `.env.example`

Statuts d'article : `brouillon` | `programme` | `publie` | `archive`. Public = `publie` ET `publishedAt` ≤ maintenant.
Types : `information` | `opinion` | `tribune` | `editorial` | `analyse` (+ `sponsored`).
`articles.json` contient 1 brouillon-modèle (non publié) : le garder comme référence de schéma.

## Dette connue (à traiter)
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
