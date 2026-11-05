# HNet Media — Site statique (Phase 1, sans base de données)

Ce projet remplace l'ancien SPA mono-fichier (`#/politique`, `#/sport`…) par une
**vraie architecture multi-pages**, générée à partir de fichiers JSON qui font
office de contenu (pas de base de données, comme demandé). Le design visuel
n'a **pas été modifié**.

## Comment ça marche

```
content/*.json   →   node build.js   →   dist/  (le site prêt à déployer)
```

- `content/articles.json`, `authors.json`, `categories.json`, `tags.json`,
  `site-settings.json` : votre contenu. C'est le "faux DB" transitoire.
- `partials/header.html`, `partials/footer.html` : le design commun (logo,
  nav, ticker, footer, newsletter), injecté dans chaque page.
- `pages/*.html` : le contenu des pages fixes (À propos, Contact, mentions
  légales…).
- `assets/style.css`, `assets/*.js` : le design system et les comportements
  (inchangés visuellement).
- `admin/index.html` : outil local d'aide à la rédaction (voir plus bas).
- `build.js` : le générateur. **Relancez `node build.js` après chaque
  modification du contenu** pour régénérer `dist/`.

## Tester le site en local

Les pages utilisent `fetch()` pour charger certains JSON (recherche, etc.),
ce qui ne fonctionne pas en ouvrant directement le fichier (`file://`).
Lancez un serveur local depuis `dist/` :

```
cd dist
python3 -m http.server 8000
# ou : npx serve
```
Puis ouvrez http://localhost:8000/

## Ajouter un article

1. Ouvrez `admin/index.html` (localement, ou déployé avec un accès restreint
   — voir l'avertissement dans la page : **cet outil n'a aucune
   authentification**, ce n'est pas un vrai espace d'administration).
2. Remplissez le formulaire, cliquez sur **Générer le JSON**, puis **Copier**.
3. Collez l'objet généré dans le tableau `content/articles.json`.
4. Mettez `"status": "publie"` (et une `publishedAt` passée) pour qu'il
   apparaisse sur le site.
5. Relancez `node build.js`.

## Déploiement — URLs propres

Les vraies pages sont des fichiers `.html` (ex. `/article/mon-slug.html`).
La plupart des hébergeurs statiques (Netlify, Vercel, GitHub Pages) servent
automatiquement `/mon-slug` à partir de `mon-slug.html`. Des fichiers de
configuration sont fournis pour garantir ce comportement partout :

- `_redirects` → Netlify
- `vercel.json` → Vercel
- `.htaccess` → Apache / hébergement mutualisé

## Ce qui nécessite une vraie base de données / un backend (Phase 2)

Ces points sont **honnêtement non simulés** — le code est prêt à les
recevoir, mais ils ne fonctionnent pas tant qu'aucun backend n'est branché :

| Fonctionnalité | État actuel | Pour l'activer |
|---|---|---|
| Envoi réel du formulaire de contact | Validation OK, envoi désactivé | Renseigner `CONTACT_ENDPOINT` dans `assets/contact.js` (Formspree, Netlify Forms, API interne…) |
| Inscription newsletter réelle | Validation OK, envoi désactivé | Renseigner `NEWSLETTER_ENDPOINT` dans `assets/newsletter.js` (Brevo, Mailchimp…) |
| Statistiques newsletter (abonnés, etc.) | Masquées (aucun chiffre inventé) | Remplir `newsletterStats` dans `content/site-settings.json` |
| "Les plus lus" / tendances | État vide honnête | Nécessite un vrai outil de mesure d'audience |
| Espace d'administration sécurisé | Non disponible (outil local sans auth) | Nécessite un backend + une base de données pour gérer des comptes |
| Traduction anglaise du contenu éditorial | Structure prête (`lang`, bandeau honnête) | Traduire manuellement et enrichir le modèle de données |

## Structure des routes

```
/                          accueil
/politique, /monde, ...    8 rubriques
/article/{slug}            fiche article
/auteur/{id}               profil auteur
/tag/{slug}                articles par tag
/recherche?q=...           recherche
/a-propos, /equipe, /charte-editoriale, /partenaires, /publicite, /carrieres
/contact, /mentions-legales, /cgu, /confidentialite, /cookies, /plan-du-site
/404
```

Les anciennes URLs `#/politique` etc. sont automatiquement redirigées vers
leur nouvelle route (voir `assets/main.js`).
