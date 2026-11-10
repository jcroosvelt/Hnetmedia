"use strict";
/**
 * Pages fixes modifiables depuis /admin (À propos, Charte éditoriale, Publicité, CGU, Confidentialité, Cookies).
 * Sans ligne en base, le site garde le texte d'origine (pages/*.html). Le contenu est nettoyé (liste blanche) ;
 * le titre est un texte brut échappé à l'affichage. Chaque enregistrement relance la construction du site.
 */
const { getDb } = require("./db");
const { HttpError } = require("./http");
const v = require("./validate");
const { cleanHtml, plainText } = require("./sanitize");
const { audit } = require("./auth");
const { triggerRebuild } = require("./deploy-hook");

const PAGES = {
  "a-propos": { title: "Qui sommes-nous ?", description: "La mission, les valeurs et l'engagement éditorial de HNet Media." },
  "charte-editoriale": { title: "Charte éditoriale", description: "Les principes déontologiques de la rédaction de HNet Media." },
  "publicite": { title: "Publicité", description: "Annoncez sur HNet Media : formats, audience, contact commercial." },
  "cgu": { title: "Conditions générales d'utilisation", description: "CGU du site HNet Media." },
  "confidentialite": { title: "Politique de confidentialité", description: "Politique de confidentialité de HNet Media." },
  "cookies": { title: "Politique relative aux cookies", description: "Politique relative aux cookies de HNet Media." },
};
const known = (slug) => Object.prototype.hasOwnProperty.call(PAGES, slug);
const textOnly = (html) => plainText(html).replace(/\s+/g, " ").trim();

async function list() {
  const rows = await getDb().query("SELECT slug, title, updated_at AS \"updatedAt\" FROM site_pages");
  const by = Object.fromEntries(rows.map((r) => [r.slug, r]));
  return Object.keys(PAGES).map((slug) => ({
    slug, defaultTitle: PAGES[slug].title, title: by[slug] ? by[slug].title : PAGES[slug].title,
    custom: Boolean(by[slug]), updatedAt: by[slug] ? by[slug].updatedAt : null,
  }));
}

async function get(slug) {
  if (!known(slug)) throw new HttpError(404, "Page introuvable.");
  const r = (await getDb().query("SELECT slug, title, description, content, updated_at AS \"updatedAt\" FROM site_pages WHERE slug = $1", [slug]))[0];
  return r
    ? { ...r, custom: true, defaultTitle: PAGES[slug].title, defaultDescription: PAGES[slug].description }
    : { slug, title: PAGES[slug].title, description: PAGES[slug].description, content: null, custom: false, updatedAt: null, defaultTitle: PAGES[slug].title, defaultDescription: PAGES[slug].description };
}

async function save(s, slug, b) {
  if (!known(slug)) throw new HttpError(404, "Page introuvable.");
  const title = plainText(v.clean(b.title));
  if (title.length < 3 || title.length > 120) throw new HttpError(400, "Le titre de la page doit faire de 3 à 120 caractères.");
  const description = plainText(v.clean(b.description, true));
  if (description.length > 300) throw new HttpError(400, "La description pour les moteurs de recherche est limitée à 300 caractères.");
  const content = cleanHtml(String(b.content || ""));
  if (textOnly(content).length < 20) throw new HttpError(400, "Le texte de la page est trop court (20 caractères minimum). Pour revenir au texte d'origine, utilisez « Rétablir le texte d'origine ».");
  if (content.length > 120000) throw new HttpError(400, "Le texte de la page est trop long.");
  await getDb().query(
    `INSERT INTO site_pages (slug, title, description, content, updated_by) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, content = EXCLUDED.content, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [slug, title, description || null, content, s.user.id]);
  await audit(s.user.id, "page.modification", "page", slug);
  const rebuilt = await triggerRebuild(`page ${slug}`);
  return { ...(await get(slug)), rebuilt };
}

async function reset(s, slug) {
  if (!known(slug)) throw new HttpError(404, "Page introuvable.");
  const r = await getDb().query("DELETE FROM site_pages WHERE slug = $1 RETURNING slug", [slug]);
  if (!r.length) throw new HttpError(404, "Cette page n'a pas été modifiée : elle affiche déjà le texte d'origine.");
  await audit(s.user.id, "page.retablie", "page", slug);
  await triggerRebuild(`page rétablie ${slug}`);
  return { ok: true };
}

module.exports = { PAGES, list, get, save, reset };
