"use strict";
/**
 * Lecture du contenu PUBLIC depuis Neon, pour build.js.
 * Ne remonte que ce qui peut être publié : articles « publie » dont la date est passée,
 * partenaires actifs, offres ouvertes, auteurs actifs. Les brouillons, les articles
 * programmés et archivés ne quittent jamais la base.
 *
 * Seul le texte d'origine (original_lang) est publié pour l'instant ; les traductions
 * relues seront ajoutées avec la gestion des langues.
 */
const { getDb } = require("./db");

const iso = (v) => (v ? new Date(v).toISOString() : null);

async function loadContent() {
  const db = getDb();
  const PUBLISHED = "a.status = 'publie' AND a.published_at <= now()";

  const [cats, rows, authors, tags, partners, jobs, arts, artTags, sources, corrections] = await Promise.all([
    db.query(`SELECT slug, label, icon, color, tag_class AS "tagClass", description FROM categories ORDER BY position, slug`),
    db.query(`SELECT key, value FROM site_settings`),
    db.query(`SELECT id, name, role, bio, photo_url AS photo, social FROM authors WHERE active ORDER BY name`),
    db.query(`SELECT slug, label FROM tags ORDER BY label`),
    db.query(`SELECT name, url AS link, description FROM partners WHERE active ORDER BY position, name`),
    db.query(`SELECT slug, title, contract AS "contractType", location, description, apply_url AS "applyUrl", apply_email AS "applyEmail"
              FROM jobs WHERE status = 'ouvert' AND (closes_at IS NULL OR closes_at > now()) ORDER BY published_at DESC NULLS LAST, title`),
    db.query(`SELECT a.id, a.slug, a.type, a.sponsored, a.featured, a.urgent, a.recommended,
                     a.category_slug AS category, a.subcategory, a.author_id AS "authorId", a.author_name AS "authorName",
                     a.reading_time AS "readingTime", a.published_at AS "publishedAt",
                     t.kicker, t.title, t.excerpt, t.content, t.seo_title, t.seo_description, t.og_image_url,
                     m.url AS img_url, m.alt AS img_alt, m.caption AS img_caption, m.credit AS img_credit
              FROM articles a
              JOIN article_translations t ON t.article_id = a.id AND t.lang = a.original_lang
              LEFT JOIN media m ON m.id = a.main_media_id
              WHERE ${PUBLISHED} ORDER BY a.published_at DESC`),
    db.query(`SELECT x.article_id, g.label FROM article_tags x JOIN tags g ON g.slug = x.tag_slug JOIN articles a ON a.id = x.article_id
              WHERE ${PUBLISHED} ORDER BY g.label`),
    db.query(`SELECT s.article_id, s.name, s.url, s.description FROM article_sources s JOIN articles a ON a.id = s.article_id
              WHERE ${PUBLISHED} ORDER BY s.article_id, s.position`),
    db.query(`SELECT c.article_id, c.text, c.corrected_at FROM corrections c JOIN articles a ON a.id = c.article_id
              WHERE ${PUBLISHED} ORDER BY c.corrected_at`),
  ]);

  const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  for (const k of ["siteName", "baseUrl", "tagline", "description"]) {
    if (typeof settings[k] !== "string" || !settings[k]) {
      throw new Error(`Réglage « ${k} » absent de la base (table site_settings). Appliquez les migrations : npm run db:migrate`);
    }
  }
  settings.social = settings.social || {};
  settings.newsletterStats = settings.newsletterStats || null;
  settings.contactCategories = settings.contactCategories || [];
  settings.partners = partners;
  settings.jobs = jobs;

  const group = (list) => {
    const m = new Map();
    for (const r of list) { if (!m.has(r.article_id)) m.set(r.article_id, []); m.get(r.article_id).push(r); }
    return m;
  };
  const tagsBy = group(artTags), srcBy = group(sources), corBy = group(corrections);

  const articles = arts.map((a) => {
    const cor = (corBy.get(a.id) || []).map((c) => ({ date: iso(c.corrected_at), text: c.text }));
    return {
      id: a.id, slug: a.slug, status: "publie", type: a.type, sponsored: a.sponsored, featured: a.featured, urgent: a.urgent,
      recommended: a.recommended, category: a.category, subcategory: a.subcategory, kicker: a.kicker, title: a.title,
      excerpt: a.excerpt, authorId: a.authorId, authorName: a.authorName, publishedAt: iso(a.publishedAt),
      readingTime: a.readingTime, content: a.content,
      updatedAt: cor.length ? cor[cor.length - 1].date : null, // « mis à jour » = dernière correction publique
      mainImage: a.img_url ? { url: a.img_url, alt: a.img_alt || "", caption: a.img_caption || "", credit: a.img_credit || "" } : { url: "", alt: "", caption: "", credit: "" },
      tags: (tagsBy.get(a.id) || []).map((t) => t.label),
      sources: (srcBy.get(a.id) || []).map((s) => ({ name: s.name, url: s.url || "", description: s.description || "" })),
      corrections: cor,
      seo: { title: a.seo_title || "", description: a.seo_description || "", ogImage: a.og_image_url || "" },
    };
  });

  return { settings, categories: cats, authors: authors.map((x) => ({ ...x, social: x.social || {} })), tags, articles };
}

module.exports = { loadContent };
