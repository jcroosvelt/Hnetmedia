# HNet Media — où en est-on ?

> **Dernière mise à jour : 12 novembre 2026** · Dernier changement : admin plus robuste dans les WebView Android anciens (compléments JavaScript) et erreurs de page affichées.
> Ce fichier est mis à jour **après chaque modification** (règle du propriétaire, 11 nov. 2026).
> Site en ligne : https://hnetmedia.vercel.app · Espace rédaction : `/admin` · Version anglaise : `/en`

## 1. Ce qui marche (testé de bout en bout)

| Domaine | État | Détail |
|---|---|---|
| Site public français | ✅ En ligne | Accueil, rubriques paginées, articles, auteurs, tags, pages fixes, recherche, RSS, plan du site |
| **Version anglaise** (`/en`) | ✅ En ligne | Interface traduite ; un article n'y paraît que si sa traduction est **relue et validée par un humain** (jamais de traduction automatique) |
| Contact | ✅ Actif | Message enregistré dans la base, lu dans `/admin › Messages` |
| Espace rédaction `/admin` | ✅ En ligne | Connexion sécurisée, 6 rôles, éditeur façon traitement de texte, images |
| Tableau de bord | ✅ En ligne | Chiffres réels : lectures, plus lus (articles, rédacteurs, rubriques, mots-clés), activité |
| Mesure des lectures | ✅ Branchée le 10 nov. | Anonyme (sans cookie ni IP) ; respecte « Ne pas suivre » |
| Publication programmée | ✅ Active | Via cron-job.org toutes les 5 min (secret `CRON_SECRET` en place) |
| Médias | ✅ | Ajout, suppression protégée, nettoyage des images inutilisées |
| Équipe, partenaires, offres d'emploi | ✅ | Gérés dans `/admin`, publiés seulement si actifs / ouverts |
| Rubriques | ✅ | Noms et descriptions FR/EN et ordre modifiables ; le menu suit la base |
| Pages fixes (6) | ✅ | À propos, Charte, Publicité, CGU, Confidentialité, Cookies : modifiables en FR et EN |
| Réglages | ✅ | Nom, slogan, réseaux sociaux, mentions légales, types de demande, textes anglais |
| Favicon et icônes | ✅ | Symbole réel du logo |
| Article à approuver | ✅ Code en ligne (notification active avec la clé Firebase) | Un rédacteur sans droit de publier clique « Soumettre » → les approbateurs reçoivent « Article à approuver » ; badge « À approuver » dans la liste ; rappel unique après 2 h ; testé avec un faux Firebase |
| **Commentaires des lecteurs** | ✅ En ligne | Sous chaque article (FR et EN) : nom + e-mail facultatif (jamais affiché) + texte ; **tout commentaire attend la validation** de la rédaction ; réponses sur un niveau ; modération dans `/admin › Commentaires` (approuver, refuser, indésirable, supprimer, répondre en public) pour administrateur, rédacteur en chef et éditeur ; anti-spam (champ piège, délai, 2 par minute / 5 par heure, 2 liens maximum, doublons) ; interrupteur « Commentaires ouverts » dans Réglages ; notifications push (nouveau dépôt, rappel après 30 min, auteur prévenu à la publication). Testé en API et dans un navigateur (affichage, réponse, envoi) avec une API simulée |
| Notifications par rôle | ✅ Code en ligne (actives avec la clé Firebase) | **Administrateur** : compte verrouillé, nouveau compte. **Rédacteur en chef** : article à approuver, programmé bloqué, messages, abonnés. **Éditeur** : traduction anglaise à valider, article publié. **Journaliste / contributeur** : leur article publié, programmé, archivé, renvoyé pour modifications, corrigé. **Commercial** : demandes publicité / partenariat, article sponsorisé publié. Jamais de notification à l'auteur de l'action ; testé avec un faux Firebase |
| Notifications push (appli Android) | ⚠️ Variables Firebase ajoutées dans Vercel le 12 nov. (`/api/health` → `push: true` si la clé est lisible) ; pas encore testé de bout en bout sur un téléphone | Nouveau message de contact, nouvel abonné confirmé, article publié / programmé ; rappels des messages non traités (30 min puis toutes les 2 h, 3 maximum) via le cron existant ; testé avec un faux Firebase, pas encore sur un vrai téléphone |

## 2. Ce qui n'est PAS actif (et pourquoi)

| Fonction | État | Raison |
|---|---|---|
| Newsletter | ⏸️ Désactivée (annoncée « bientôt », formulaire masqué) | Il faut un nom de domaine vérifié chez Resend |
| E-mail d'alerte « nouveau message » | ⏸️ Non configuré | Demande les variables `RESEND_API_KEY`… dans Vercel (facultatif) |
| Adresses `redaction@hnetmedia.com`… | ⚠️ Affichées mais ne reçoivent rien | Domaine non possédé (décision du propriétaire : laisser tel quel) |
| Créole haïtien | ❌ Abandonné | Décision du propriétaire (10 nov.) |

## 3. À faire par le propriétaire

- [ ] Écrire les premiers **vrais articles** (image, rubrique, signature) ; les traduire dans l'onglet *English* et cocher « relue et validée »
- [ ] Compléter les **mentions légales** (directeur de la publication, hébergeur, immatriculation) dans Réglages
- [ ] Renseigner les **réseaux sociaux** (liens https) dans Réglages
- [ ] Créer les **fiches d'équipe**, et ajouter partenaires / offres d'emploi s'il y en a de vrais
- [ ] **Relire** les pages fixes (textes d'origine à adapter à la réalité)
- [ ] Décider du sort des **adresses e-mail** affichées (garder, remplacer ou retirer)
- [ ] **Acheter le nom de domaine** (puis changer `SITE_URL` dans Vercel et vérifier le domaine chez Resend)
- [ ] (Facultatif) Ajouter la clé **Resend** pour recevoir les messages de contact par e-mail
- [ ] **Tester les notifications push** : installer la dernière APK, se connecter à `/admin` dans l'appli, puis envoyer un message depuis le formulaire de contact (appli fermée)
- [ ] **Commentaires** : ajouter une phrase dans la page *Confidentialité* (`/admin › Pages du site`) disant que le nom, l'adresse e-mail (facultative) et le texte des commentaires sont conservés pour la modération, et que l'e-mail n'est jamais publié
- [ ] (Facultatif) Fournir une **image de marque haute définition** (le logo fait 280 px) pour l'aperçu de partage

## 4. À faire par moi (Claude), quand le propriétaire le demande

- [ ] Brancher la **newsletter** (après achat du domaine)
- [ ] Refaire les pages **article, recherche, équipe, carrières** avec un travail de style dédié (elles ont déjà la nouvelle base)
- [ ] Adresses anglaises des rubriques (`/en/politics` au lieu de `/en/politique`)
- [ ] Traduction anglaise des fiches d'équipe, partenaires et offres (données saisies en français aujourd'hui)

## 5. Décisions du propriétaire (à ne pas remettre en cause)

- Base de données **Neon**, branche `main` = production ; hébergement **Vercel** relié à GitHub (`main` = déploiement)
- **Resend** pour les e-mails (pas Brevo) ; authentification maison ; anti-spam par piège + délai
- Identité visuelle figée : **marine, orange, cyan** ; **Playfair Display + Inter** ; logo. La composition du site a été refaite le 10 nov.
- Aucune fausse donnée : sans contenu réel, un état vide honnête s'affiche
- Une fonction n'est présentée comme active que si elle l'est vraiment

## 6. Qualité

- Tests automatiques : **23 tests API** (dont push ; les 324 vérifications navigateur n'ont pas été relancées pour ce changement) et **324 vérifications navigateur** (ordinateur + mobile), tous passés au dernier changement
- La construction du site échoue si une phrase de l'interface n'a pas de traduction anglaise
- Base de production : migrations **0001 à 0010** appliquées ; branches de secours Neon conservées avant les migrations 0006 et 0007

## 7. Journal des modifications (le plus récent en haut)

| Date | Modification |
|---|---|
| 12 nov. | Admin : compléments pour WebView ancien (`Array.at/findLast`, `Object.hasOwn`, `replaceAll`…) avant l'éditeur ; toute erreur inattendue de la page s'affiche en bandeau (diagnostic des brouillons qui ne s'ouvraient pas dans l'appli Android) |
| 12 nov. | `/api/health` expose `push` (oui/non : clé Firebase présente et lisible) pour vérifier la configuration sans rien dévoiler |
| 12 nov. | **Commentaires des lecteurs** : migration 0010 (table `comments`, permission `comment.moderate`), `/api/comments`, section sous les articles (`assets/comments.js` + `comments.css`), onglet `/admin › Commentaires`, interrupteur dans Réglages, rappels push |
| 12 nov. | Notifications pour tous les rôles : `push.notify` cible aussi des comptes précis ; « Renvoyer pour modifications » (`POST articles/:id/review-return`) ; alertes sécurité et comptes ; commercial ; programmés bloqués (une seule alerte) |
| 12 nov. | « Article à approuver » : migration 0009, `POST /api/admin/articles/:id/review`, bouton « Demander l'approbation », badge, rappel unique ; `push.notifyNewComment` prêt pour les futurs commentaires |
| 12 nov. | Notifications push pour l'appli Android : table `device_tokens` (migration 0008), `POST/DELETE /api/admin/devices`, `server/push.js` (Firebase HTTP v1), déclencheurs contact / abonné / publication, rappels dans `/api/scheduled` |
| 11 nov. | Création de ce fichier d'état |
| 10 nov. | **Version anglaise** (`/en`), rubriques modifiables, URLs propres sans `.html`, créole retiré, nettoyage des images inutilisées, image de partage, style des pages fixes et du contact |
| 10 nov. | **Refonte de l'interface publique** : accueil, en-tête, cartes, pied de page ; mesure des lectures enfin branchée |
| 10 nov. | Pages fixes modifiables depuis `/admin` ; texte du pied de page |
| 11 nov. | Règle enregistrée : chaque modification est poussée directement sur `main` (déploiement) |
| 9 nov. | Tableau de bord (2 designs), statistiques réelles, plus lus |
| 9 nov. | Favicon : symbole réel du logo |
| 8 nov. | Médias, équipe, partenaires, offres, réglages ; pagination des tags et auteurs |
| 7 nov. | Publication programmée, pagination des rubriques, `SITE_URL` |
| 6 nov. | Téléversement d'images, éditeur façon Word, contact réel, Resend, le site se construit depuis Neon |
| 5 nov. | Base Neon, espace `/admin`, sécurité, fonctions serveur |
