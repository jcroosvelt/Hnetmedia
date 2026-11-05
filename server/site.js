"use strict";
/** Constantes partagées entre les fonctions serveur. */

function siteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  const host = req && (req.headers["x-forwarded-host"] || req.headers.host);
  return host ? `https://${host}` : "https://www.hnetmedia.com";
}

// Texte exact du consentement newsletter, enregistré avec chaque inscription.
// Toute modification doit être reportée à l'identique dans le formulaire.
const NEWSLETTER_CONSENT =
  "J'accepte de recevoir la newsletter de HNet Media par e-mail. Je peux me désinscrire à tout moment via le lien présent dans chaque envoi.";

const DEFAULT_CONTACT_CATEGORIES = ["Rédaction", "Correction", "Publicité", "Partenariat", "Recrutement", "Autre"];

module.exports = { siteUrl, NEWSLETTER_CONSENT, DEFAULT_CONTACT_CATEGORIES };
