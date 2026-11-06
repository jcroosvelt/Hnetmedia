# HNet Media — contexte projet (lu automatiquement par Claude Code)

Média en ligne « L'actualité sans frontières » (Joseph / J. Roosvelt Jean Charles, Pétion-Ville, Haïti).
Site statique multi-pages généré par `build.js` (Node) **à partir de Neon** (plus aucun fichier de contenu dans le dépôt) — **Phase 2 en cours** : contenu dans Neon (PostgreSQL), hébergement **Vercel** relié au dépôt GitHub `jcroosvelt/hnetmedia` : **chaque modification est commitée et poussée sur `main`**, ce qui déclenche le déploiement (pas de déploiement Vercel direct).

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
5. Site léger et simple à maintenir depuis un téléphone : tout se gère dans `/admin` (aucun fichier de contenu à éditer). `build.js` exige `DATABASE_URL` et **refuse de produire un site vide** si la base est injoignable (le déploiement échoue, l'ancienne version reste en ligne). Dépendances npm limitées au strict nécessaire ; Vercel n'installe que les dépendances de production (`npm ci --omit=dev`).
6. Répondre et commenter en français.

## Architecture
```
Neon (main ; dev = essais) ──node build.js──▶  dist/  ──▶  Vercel (push sur main = déploiement)
        ▲                                                   ▲
   /admin + /api                       Deploy Hook (VERCEL_DEPLOY_HOOK_URL) à chaque publication
```
- `partials/header.html`, `footer.html` : design commun injecté partout
- `pages/*.html` : fragments des pages fixes (à-propos, équipe, charte, partenaires, publicité, carrières, contact, légales, plan du site, recherche, 404)
- `build.js` : génère accueil, 8 rubriques, `/article/{slug}.html`, `/auteur/{id}.html`, `/tag/{slug}.html`, pages fixes, `dist/content/search-index.json` (seul fichier JSON, généré), `sitemap.xml`, `rss.xml`, `robots.txt`, JSON-LD (NewsArticle, BreadcrumbList, Organization, WebSite+SearchAction)
- `assets/` : `style.css`, `main.js` (date, nav active, FR/EN, partage, redirection des anciens `#/route`), `contact.js` (**actif** : envoi réel vers `/api/contact`, messages du serveur affichés tels quels), `newsletter.js` (`NEWSLETTER_ENDPOINT` vide : **non branché**, voir dette), `search.js` (recherche client sur l'index)
- `admin-app/` : **espace rédaction sécurisé** servi sur `/admin` (aucun lien depuis le site, `noindex`, CSP stricte dans `vercel.json`). `index.html` + `admin.css` (variables/polices du site uniquement) + `admin.js` (interface, JS sans dépendance, DOM via textContent) + `editor.src.js` → **`editor.js` compilé et versionné** (TipTap/ProseMirror, MIT). Après toute modification de `editor.src.js` : `npm run build:editor` puis committer `editor.js`. L'ancien outil `admin/` (sans authentification) est supprimé.
- `assets/article-body.css` : typographie du corps d'article (h2-h4, listes, citations, figures, tableaux), feuille SÉPARÉE de `style.css` (qui reste intact), partagée par les pages d'article (`.article-body`) et l'éditeur (aperçu fidèle). Couleurs et polices existantes uniquement.
- `vercel.json` (installation de production seulement, build `node build.js`, sortie `dist/`, URLs propres, en-têtes de sécurité), `.vercelignore` (tests, db/, sources et docs non envoyés). Ni Netlify ni Apache.
- `serve.js` : serveur statique local (aperçu de `dist/` après `node build.js`)
- `api/` : fonctions serverless Vercel — `contact.js`, `newsletter.js` (subscribe/confirm/unsubscribe), `views.js` (compteur + plus lus/tendances), `admin.js` (auth + API d'administration), `health.js` (contrôle : base joignable ?). Réécritures dans `vercel.json`.
- `server/` : code partagé des fonctions et du build (`content.js` = lecture Neon pour `build.js`, `env.js`, db, http, sécurité, rate limiting, validation, anti-spam, e-mail (Resend), auth scrypt/sessions/CSRF, articles, nettoyage HTML)
- `db/` : `migrations/*.sql` (0001 schéma, 0002 rôles, 0003 rubriques + réglages de base, 0004 « Droit de réponse » dans les types de demande du contact), `migrate.js`
- `test/` : `npm test` (API de bout en bout) et `npm run test:browser` (Playwright : interface /admin, droits par rôle, barre de recherche, mobile + ordinateur) contre un PostgreSQL **local** (`TEST_PG_ADMIN_URL`, port 5433), jamais contre Neon
- Dépendances de production figées : `sanitize-html` en **2.13.1** exactement (les versions ≥ 2.14 tirent htmlparser2 12, module ESM seul : la fonction admin plante sur Vercel). Node imposé : 22.x.
- Sécurité du rendu : les textes (titres, chapeaux…) sont stockés **en texte brut** (« & » et non « &amp; »), balises retirées ; l'échappement se fait **à l'affichage** (`escAttr` dans `build.js`, `esc()` dans `search.js`). Tout JSON placé dans une balise `<script>` (JSON-LD) passe par `server/html.js › jsonForHtml` (échappe `< > &`) : un titre ne doit jamais pouvoir écrire `</script>`. Ne jamais insérer un champ d'article en HTML sans l'échapper.
- `style.css` : seules corrections de bogue autorisées (design inchangé). Corrigé le 6 nov. 2026 : loupe de recherche cliquable (`pointer-events` retiré) ; en-tête mobile (≤ 700 px : logo 40 px, recherche flexible, FR/EN visibles ; ≤ 360 px : logo 34 px) ; cartes `.static-grid` sur une colonne ≤ 700 px et adresses longues qui se coupent (elles débordaient).
- Variables d'environnement : voir `.env.example`

Statuts d'article : `brouillon` | `programme` | `publie` | `archive`. Public = `publie` ET `published_at` ≤ maintenant (seuls ceux-là sont lus par `build.js`).
Types : `information` | `opinion` | `tribune` | `editorial` | `analyse` (+ `sponsored`).
Le schéma de référence est dans `db/migrations/`. Le brouillon-modèle `exemple-001` existe encore dans la base de production (statut brouillon) : à supprimer depuis `/admin` s'il gêne.

## E-mails (Resend) — état
- Fournisseur : **Resend** (`server/email.js`). **Aucun nom de domaine acheté pour l'instant** : tant qu'aucun domaine n'est vérifié chez Resend, seuls sont possibles les envois **à l'équipe** depuis `onboarding@resend.dev` vers l'adresse du compte Resend (`isConfigured()` : alerte « nouveau message » via `CONTACT_NOTIFY_EMAIL`). Écrire à des **lecteurs** (confirmation de newsletter) exige un domaine vérifié (`canSendToPublic()`) : la newsletter répond « non activée » sinon.
- **Contact : actif** (message enregistré dans Neon, lu dans `/admin › Messages`). Sans `RESEND_API_KEY`, personne n'est prévenu par e-mail : il faut ouvrir `/admin`.
- Variables : `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME`, `CONTACT_NOTIFY_EMAIL` (voir `.env.example`).

## Dette connue (à traiter)
- **Adresses e-mail affichées publiquement** (`pages/contact.html`, `partials/footer.html`, réglage `contactEmail`) : `redaction@hnetmedia.com`, `partenariats@hnetmedia.com`… sur un domaine **non possédé** → ces adresses ne reçoivent rien. À remplacer par de vraies adresses ou à retirer (décision du propriétaire).
- **Newsletter** : à brancher quand un domaine est acheté et vérifié chez Resend (puis `NEWSLETTER_ENDPOINT` → `/api/newsletter/subscribe`, pages de confirmation `/newsletter-confirmation` et de désinscription à créer).
- **Publication programmée** : un article programmé n'apparaît qu'au premier déploiement après sa date (aucun déclencheur horaire). À faire : appel périodique d'un point d'entrée protégé qui lance le Deploy Hook.
- Images des articles : adresse https saisie à la main ; le téléversement (médiathèque) reste à faire.
- Pagination des rubriques : conteneur `#catPagination` et `window.__CAT_TOTAL__` présents, **aucun JS** ne pagine encore (10/page prévu).
- `newsletterStats` : conteneur `#nlStats` masqué, **aucun JS/rendu** ; ne l'afficher que si renseigné dans `site_settings`.
- Convention d'URL à trancher : liens du header/footer sans `.html` (`/politique`), canonical/sitemap/cartes avec `.html`. Choisir une seule forme partout.
- Liens sociaux du footer = `#` (à alimenter depuis `site-settings.social`, masquer si vide).
- `og:image` par défaut = `icon-512.png` : prévoir une vraie image 1200×630.
- Mentions légales : champs `[à renseigner]` — ne rien inventer (éditeur, hébergeur, n° d'entreprise).
- Pages `/a-propos` etc. : texte en dur dans `pages/` (non administrable).
- FR/EN : seul l'UI bascule, le contenu éditorial n'est pas traduit (bandeau honnête affiché).
- `lang` : le site est trilingue (FR/EN/Kreyòl) — le kreyòl n'est pas encore géré.

## Phase 2 (en cours — Neon + Vercel)
Remplacer la lecture JSON de `build.js` par des requêtes ; brancher contact + newsletter ; auth admin et rôles ; analytics (plus lus, tendances) ; médiathèque ; programmation réelle des articles.
