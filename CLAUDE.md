# HNet Media — contexte projet (lu automatiquement par Claude Code)

Média en ligne « L'actualité sans frontières » (Joseph / J. Roosvelt Jean Charles, Pétion-Ville, Haïti).
Site statique multi-pages généré par `build.js` (Node, **zéro dépendance**) à partir de `content/*.json`.

## Règles absolues
1. **Ne pas refaire le design.** `assets/style.css`, logo, couleurs (marine, orange, cyan), Playfair Display + Inter, header, ticker, cartes, footer : intouchables. Toute nouvelle UI réutilise les classes existantes. Pas de nouveau gradient, pas de nouvelle couleur.
2. **Aucune base de données, aucun backend, aucun service distant dans cette phase.** Ne pas demander d'identifiants DB. La couche de contenu = fichiers JSON.
3. **Aucun faux contenu.** Pas de « Titre article », faux auteurs, faux partenaires, faux chiffres (abonnés, audience), fausses sources, faux postes. Sans donnée réelle : état vide professionnel (`emptyState()` dans build.js) ou champ administrable.
4. **Honnêteté fonctionnelle.** Ce qui exige un backend (envoi du contact, newsletter, « plus lus », auth admin) reste signalé comme non connecté. Jamais de fausse confirmation.
5. Zéro dépendance npm pour `build.js` et `serve.js`. Garder le projet utilisable depuis un téléphone Android (Acode).
6. Répondre et commenter en français.

## Architecture
```
content/*.json  ──node build.js──▶  dist/   (site prêt à déployer)
```
- `content/` : articles, authors, categories, tags, site-settings (partners, jobs, endpoints, newsletterStats)
- `partials/header.html`, `footer.html` : design commun injecté partout
- `pages/*.html` : fragments des pages fixes (à-propos, équipe, charte, partenaires, publicité, carrières, contact, légales, plan du site, recherche, 404)
- `build.js` : génère accueil, 8 rubriques, `/article/{slug}.html`, `/auteur/{id}.html`, `/tag/{slug}.html`, pages fixes, `content/search-index.json`, `sitemap.xml`, `rss.xml`, `robots.txt`, JSON-LD (NewsArticle, BreadcrumbList, Organization, WebSite+SearchAction)
- `assets/` : `style.css`, `main.js` (date, nav active, FR/EN, partage, redirection des anciens `#/route`), `contact.js` / `newsletter.js` (`CONTACT_ENDPOINT` / `NEWSLETTER_ENDPOINT` vides), `search.js` (recherche client sur l'index)
- `admin/index.html` : outil local qui génère du JSON d'article — **sans authentification**, `noindex`, `Disallow` dans robots.txt
- `_redirects` (Netlify), `vercel.json`, `.htaccess` : URLs propres
- `serve.js` : serveur local avec URLs propres → `npm run dev` ou `node build.js && node serve.js`

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

## Phase 2 (quand une base de données sera décidée)
Remplacer la lecture JSON de `build.js` par des requêtes ; brancher contact + newsletter ; auth admin et rôles ; analytics (plus lus, tendances) ; médiathèque ; programmation réelle des articles.
