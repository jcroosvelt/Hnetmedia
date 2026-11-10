"use strict";
/**
 * Pages fixes modifiables depuis /admin (À propos, Charte éditoriale, Publicité, CGU, Confidentialité, Cookies),
 * en français et en anglais (une version par langue). Sans ligne en base, le site garde le texte d'origine
 * (pages/*.html et pages/en/*.html). Le contenu est nettoyé (liste blanche) ; le titre est un texte brut échappé
 * à l'affichage. Chaque enregistrement relance la construction du site.
 */
const { getDb } = require("./db");
const { HttpError } = require("./http");
const v = require("./validate");
const { cleanHtml, plainText } = require("./sanitize");
const { audit } = require("./auth");
const { triggerRebuild } = require("./deploy-hook");
const EN = require("../i18n/en");

const FR_DEFAULTS = {
  "a-propos": { title: "Qui sommes-nous ?", description: "La mission, les valeurs et l'engagement éditorial de HNet Media." },
  "charte-editoriale": { title: "Charte éditoriale", description: "Les principes déontologiques de la rédaction de HNet Media." },
  "publicite": { title: "Publicité", description: "Annoncez sur HNet Media : formats, audience, contact commercial." },
  "cgu": { title: "Conditions générales d'utilisation", description: "CGU du site HNet Media." },
  "confidentialite": { title: "Politique de confidentialité", description: "Politique de confidentialité de HNet Media." },
  "cookies": { title: "Politique relative aux cookies", description: "Politique relative aux cookies de HNet Media." },
};
const LANGS = ["fr", "en"];
const PAGES = Object.fromEntries(Object.entries(FR_DEFAULTS).map(([slug, d]) => [slug, {
  fr: d, en: { title: EN[d.title] || d.title, description: EN[d.description] || d.description },
}]));
const known = (slug) => Object.prototype.hasOwnProperty.call(PAGES, slug);
const lang_ = (l) => { if (!LANGS.includes(l)) throw new HttpError(400, "Langue inconnue (fr ou en)."); return l; };
const textOnly = (html) => plainText(html).replace(/\s+/g, " ").trim();

async function list() {
  const rows = await getDb().query("SELECT slug, lang, title, updated_at AS \"updatedAt\" FROM site_pages");
  const by = Object.fromEntries(rows.map((r) => [`${r.lang}/${r.slug}`, r]));
  return Object.keys(PAGES).map((slug) => ({
    slug, defaultTitle: PAGES[slug].fr.title,
    versions: Object.fromEntries(LANGS.map((l) => [l, {
      title: by[`${l}/${slug}`] ? by[`${l}/${slug}`].title : PAGES[slug][l].title,
      custom: Boolean(by[`${l}/${slug}`]), updatedAt: by[`${l}/${slug}`] ? by[`${l}/${slug}`].updatedAt : null,
    }])),
  }));
}

async function get(slug, lang) {
  if (!known(slug)) throw new HttpError(404, "Page introuvable.");
  lang = lang_(lang);
  const d = PAGES[slug][lang];
  const r = (await getDb().query("SELECT slug, lang, title, description, content, updated_at AS \"updatedAt\" FROM site_pages WHERE slug = $1 AND lang = $2", [slug, lang]))[0];
  return r
    ? { ...r, custom: true, defaultTitle: d.title, defaultDescription: d.description }
    : { slug, lang, title: d.title, description: d.description, content: null, custom: false, updatedAt: null, defaultTitle: d.title, defaultDescription: d.description };
}

async function save(s, slug, lang, b) {
  if (!known(slug)) throw new HttpError(404, "Page introuvable.");
  lang = lang_(lang);
  const title = plainText(v.clean(b.title));
  if (title.length < 3 || title.length > 120) throw new HttpError(400, "Le titre de la page doit faire de 3 à 120 caractères.");
  const description = plainText(v.clean(b.description, true));
  if (description.length > 300) throw new HttpError(400, "La description pour les moteurs de recherche est limitée à 300 caractères.");
  const content = cleanHtml(String(b.content || ""));
  if (textOnly(content).length < 20) throw new HttpError(400, "Le texte de la page est trop court (20 caractères minimum). Pour revenir au texte d'origine, utilisez « Rétablir le texte d'origine ».");
  if (content.length > 120000) throw new HttpError(400, "Le texte de la page est trop long.");
  await getDb().query(
    `INSERT INTO site_pages (slug, lang, title, description, content, updated_by) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (slug, lang) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, content = EXCLUDED.content, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [slug, lang, title, description || null, content, s.user.id]);
  await audit(s.user.id, "page.modification", "page", `${lang}/${slug}`);
  const rebuilt = await triggerRebuild(`page ${lang}/${slug}`);
  return { ...(await get(slug, lang)), rebuilt };
}

async function reset(s, slug, lang) {
  if (!known(slug)) throw new HttpError(404, "Page introuvable.");
  lang = lang_(lang);
  const r = await getDb().query("DELETE FROM site_pages WHERE slug = $1 AND lang = $2 RETURNING slug", [slug, lang]);
  if (!r.length) throw new HttpError(404, "Cette page n'a pas été modifiée : elle affiche déjà le texte d'origine.");
  await audit(s.user.id, "page.retablie", "page", `${lang}/${slug}`);
  await triggerRebuild(`page rétablie ${lang}/${slug}`);
  return { ok: true };
}

module.exports = { PAGES, list, get, save, reset };
