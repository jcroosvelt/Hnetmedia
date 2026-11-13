"use strict";
/**
 * Lecture du contenu PUBLIC depuis Neon, pour build.js.
 * Ne remonte que ce qui peut être publié : articles « publie » (ou « programme » échu) dont la date est passée,
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
  // Public = « publié » dont la date est passée, ou « programmé » dont l'heure est arrivée (le déclencheur
  // horaire fait passer ces derniers à « publié » ; ici, tout déploiement après l'heure les inclut déjà).
  const PUBLISHED = "a.status IN ('publie', 'programme') AND a.published_at <= now()";

  const [cats, rows, authors, tags, partners, jobs, arts, artTags, sources, corrections, pageRows, trRows] = await Promise.all([
    db.query(`SELECT slug, label, icon, color, tag_class AS "tagClass", description, label_en AS "labelEn", description_en AS "descriptionEn" FROM categories ORDER BY position, slug`),
    db.query(`SELECT key, value FROM site_settings`),
    db.query(`SELECT id, name, role, bio, photo_url AS photo, social FROM authors WHERE active ORDER BY name`),
    db.query(`SELECT slug, label FROM tags ORDER BY label`),
    db.query(`SELECT name, url AS link, description FROM partners WHERE active ORDER BY position, name`),
    db.query(`SELECT slug, title, contract AS "contractType", location, description, apply_url AS "applyUrl", apply_email AS "applyEmail"
              FROM jobs WHERE status = 'ouvert' AND (closes_at IS NULL OR closes_at > now()) ORDER BY published_at DESC NULLS LAST, title`),
    db.query(`SELECT a.id, a.slug, a.status::text AS status, a.type, a.sponsored, a.featured, a.urgent, a.recommended,
                     a.category_slug AS category, a.subcategory, a.author_id AS "authorId", a.author_name AS "authorName",
                     a.original_lang::text AS "originalLang", a.reading_time AS "readingTime", a.published_at AS "publishedAt",
                     m.url AS img_url, m.alt AS img_alt, m.caption AS img_caption, m.credit AS img_credit
              FROM articles a
              LEFT JOIN media m ON m.id = a.main_media_id
              WHERE ${PUBLISHED}
              ORDER BY a.published_at DESC`),
    db.query(`SELECT x.article_id, g.label FROM article_tags x JOIN tags g ON g.slug = x.tag_slug JOIN articles a ON a.id = x.article_id
              WHERE ${PUBLISHED} ORDER BY g.label`),
    db.query(`SELECT s.article_id, s.name, s.url, s.description FROM article_sources s JOIN articles a ON a.id = s.article_id
              WHERE ${PUBLISHED} ORDER BY s.article_id, s.position`),
    db.query(`SELECT c.article_id, c.text, c.corrected_at FROM corrections c JOIN articles a ON a.id = c.article_id
              WHERE ${PUBLISHED} ORDER BY c.corrected_at`),
    db.query(`SELECT slug, lang, title, description, content FROM site_pages`),
    // Toutes les traductions des articles diffusables : la langue d'origine est publiée telle quelle,
    // une autre langue seulement une fois relue et validée par un humain (reviewed).
    db.query(`SELECT t.article_id, t.lang::text AS lang, t.kicker, t.title, t.excerpt, t.content, t.seo_title, t.seo_description, t.og_image_url, t.reviewed
              FROM article_translations t JOIN articles a ON a.id = t.article_id WHERE ${PUBLISHED}`),
  ]);

  const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  for (const k of ["siteName", "baseUrl", "tagline", "description"]) {
    if (typeof settings[k] !== "string" || !settings[k]) {
      throw new Error(`Réglage « ${k} » absent de la base (table site_settings). Appliquez les migrations : npm run db:migrate`);
    }
  }
  settings.social = settings.social || {};
  settings.legal = settings.legal || {};
  settings.newsletterStats = settings.newsletterStats || null;
  settings.contactCategories = settings.contactCategories || [];
  settings.partners = partners;
  settings.jobs = jobs;
  // Pages fixes modifiées dans /admin : clé « langue/slug » (ex. « fr/a-propos », « en/a-propos »).
  settings.pages = Object.fromEntries(pageRows.map((p) => [`${p.lang}/${p.slug}`, { title: p.title, description: p.description || "", content: p.content }]));

  const group = (list) => {
    const m = new Map();
    for (const r of list) { if (!m.has(r.article_id)) m.set(r.article_id, []); m.get(r.article_id).push(r); }
    return m;
  };
  const tagsBy = group(artTags), srcBy = group(sources), corBy = group(corrections);

  const trBy = new Map();
  for (const t of trRows) { if (!trBy.has(t.article_id)) trBy.set(t.article_id, {}); trBy.get(t.article_id)[t.lang] = t; }
  const toTr = (t) => ({
    kicker: t.kicker || "", title: t.title || "", excerpt: t.excerpt || "", content: t.content || "", reviewed: Boolean(t.reviewed),
    seo: { title: t.seo_title || "", description: t.seo_description || "", ogImage: t.og_image_url || "" },
  });

  const articles = arts.filter((a) => {
    const orig = (trBy.get(a.id) || {})[a.originalLang];
    if (!orig) return false; // pas de texte d'origine : jamais publié
    // un article « programmé » n'est affiché que s'il est encore complet : rubrique, signature, texte ET image principale (jamais à moitié publié)
    return a.status === "publie" || (a.category && a.img_url && (a.authorId || String(a.authorName || "").trim()) && String(orig.content || "").trim());
  }).map((a) => {
    const cor = (corBy.get(a.id) || []).map((c) => ({ date: iso(c.corrected_at), text: c.text }));
    const tr = Object.fromEntries(Object.entries(trBy.get(a.id)).filter(([l]) => l === "fr" || l === "en").map(([l, t]) => [l, toTr(t)]));
    const o = tr[a.originalLang];
    return {
      id: a.id, slug: a.slug, status: "publie", type: a.type, sponsored: a.sponsored, featured: a.featured, urgent: a.urgent,
      recommended: a.recommended, category: a.category, subcategory: a.subcategory, kicker: o.kicker, title: o.title,
      excerpt: o.excerpt, authorId: a.authorId, authorName: a.authorName, publishedAt: iso(a.publishedAt),
      readingTime: a.readingTime, content: o.content, originalLang: a.originalLang, tr,
      updatedAt: cor.length ? cor[cor.length - 1].date : null, // « mis à jour » = dernière correction publique
      mainImage: a.img_url ? { url: a.img_url, alt: a.img_alt || "", caption: a.img_caption || "", credit: a.img_credit || "" } : { url: "", alt: "", caption: "", credit: "" },
      tags: (tagsBy.get(a.id) || []).map((t) => t.label),
      sources: (srcBy.get(a.id) || []).map((s) => ({ name: s.name, url: s.url || "", description: s.description || "" })),
      corrections: cor,
      seo: o.seo,
    };
  });

  return { settings, categories: cats, authors: authors.map((x) => ({ ...x, social: x.social || {} })), tags, articles };
}

module.exports = { loadContent };
