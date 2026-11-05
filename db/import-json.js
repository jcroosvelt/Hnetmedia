#!/usr/bin/env node
"use strict";
/**
 * HNet Media — import content/*.json → Neon
 * ─────────────────────────────────────────────────────────
 * Copie les vraies données des fichiers JSON dans la base.
 *
 *   node db/import-json.js              importe (insère uniquement ce qui manque)
 *   node db/import-json.js --update     écrase aussi les lignes existantes avec le JSON
 *   node db/import-json.js --dry-run    valide et affiche le plan, sans rien écrire
 *   node db/import-json.js --print-sql  affiche le SQL (pour exécution manuelle sur dev)
 *
 * Garanties :
 *  - Aucune suppression. Ré-exécutable sans doublon (ON CONFLICT).
 *  - Par défaut, ne touche pas aux lignes déjà présentes : une modification
 *    faite ensuite dans l'admin n'est jamais écrasée sans --update.
 *  - Les statuts sont importés tels quels : le brouillon-modèle reste `brouillon`.
 *  - Rien n'est inventé : champs vides → NULL, listes vides → rien.
 *  - Requêtes paramétrées ($1, $2…) ; DATABASE_URL lue dans l'environnement.
 */
const fs = require("fs");
const path = require("path");
require("./lib/env")();

const CONTENT = path.join(__dirname, "..", "content");
const STATUSES = ["brouillon", "programme", "publie", "archive"];
const TYPES = ["information", "opinion", "tribune", "editorial", "analyse"];
const SETTINGS_TO_TABLES = ["partners", "jobs"];
// Anciennes options de la phase 1, remplacées par les fonctions /api.
const SETTINGS_OBSOLETE = ["contactEndpoint", "newsletterEndpoint"];

const load = (f) => JSON.parse(fs.readFileSync(path.join(CONTENT, f), "utf8"));
const blank = (v) => (v === undefined || v === null || (typeof v === "string" && v.trim() === "") ? null : v);
const slugify = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function buildPlan({ update = false } = {}) {
  const categories = load("categories.json");
  const authors = load("authors.json");
  const tags = load("tags.json");
  const articles = load("articles.json");
  const settings = load("site-settings.json");

  const errors = [];
  const q = []; // { label, text, params }
  const conflict = (key, cols) => update
    ? `ON CONFLICT (${key}) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(", ")}`
    : `ON CONFLICT (${key}) DO NOTHING`;
  const counts = { categories: 0, settings: 0, authors: 0, tags: 0, partners: 0, jobs: 0, articles: 0, sources: 0, corrections: 0 };

  /* Rubriques */
  categories.forEach((c, i) => {
    q.push({
      label: `rubrique ${c.slug}`,
      text: `INSERT INTO categories (slug, label, icon, color, tag_class, description, position)
             VALUES ($1, $2, $3, $4, $5, $6, $7) ${conflict("slug", ["label", "icon", "color", "tag_class", "description", "position"])}`,
      params: [c.slug, c.label, blank(c.icon), blank(c.color), blank(c.tagClass), blank(c.description), i],
    });
    counts.categories++;
  });

  /* Réglages du site */
  for (const [key, value] of Object.entries(settings)) {
    if (SETTINGS_TO_TABLES.includes(key) || SETTINGS_OBSOLETE.includes(key)) continue;
    q.push({
      label: `réglage ${key}`,
      text: `INSERT INTO site_settings (key, value) VALUES ($1, $2::jsonb) ${conflict("key", ["value"])}`,
      params: [key, JSON.stringify(value)],
    });
    counts.settings++;
  }

  /* Auteurs */
  authors.forEach((a) => {
    if (!a.id || !a.name) return errors.push(`auteur sans id ou sans nom : ${JSON.stringify(a).slice(0, 80)}`);
    q.push({
      label: `auteur ${a.id}`,
      text: `INSERT INTO authors (id, name, role, bio, photo_url, social)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb) ${conflict("id", ["name", "role", "bio", "photo_url", "social"])}`,
      params: [a.id, a.name, blank(a.role), blank(a.bio), blank(a.photo), JSON.stringify(a.social || {})],
    });
    counts.authors++;
  });

  /* Tags : ceux de tags.json + ceux cités par les articles */
  const tagMap = new Map();
  tags.forEach((t) => {
    const label = typeof t === "string" ? t : (t.label || t.name);
    const slug = typeof t === "string" ? slugify(t) : (t.slug || slugify(label));
    if (slug && label) tagMap.set(slug, label);
  });
  articles.forEach((a) => (a.tags || []).forEach((t) => { const s = slugify(t); if (s && !tagMap.has(s)) tagMap.set(s, t); }));
  for (const [slug, label] of tagMap) {
    q.push({ label: `tag ${slug}`, text: `INSERT INTO tags (slug, label) VALUES ($1, $2) ${conflict("slug", ["label"])}`, params: [slug, label] });
    counts.tags++;
  }

  /* Partenaires (site-settings.partners) */
  (settings.partners || []).forEach((p, i) => {
    if (!p.name) return errors.push("partenaire sans nom");
    q.push({
      label: `partenaire ${p.name}`,
      text: `INSERT INTO partners (name, url, description, position)
             SELECT $1, $2, $3, $4 WHERE NOT EXISTS (SELECT 1 FROM partners WHERE name = $1)`,
      params: [p.name, blank(p.link || p.url), blank(p.description), i],
    });
    counts.partners++;
  });

  /* Offres d'emploi (site-settings.jobs) */
  (settings.jobs || []).forEach((j) => {
    if (!j.title || !j.description) return errors.push(`offre sans titre ou sans description : ${j.title || "?"}`);
    q.push({
      label: `offre ${j.title}`,
      text: `INSERT INTO jobs (slug, title, contract, location, description, apply_url, apply_email, status, published_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'ouvert', now()) ${conflict("slug", ["title", "contract", "location", "description", "apply_url", "apply_email"])}`,
      params: [j.slug || slugify(j.title), j.title, blank(j.contractType), blank(j.location), j.description, blank(j.applyUrl), blank(j.applyEmail)],
    });
    counts.jobs++;
  });

  /* Articles */
  const catSlugs = new Set(categories.map((c) => c.slug));
  const authorIds = new Set(authors.map((a) => a.id));
  articles.forEach((a) => {
    const where = `article « ${a.slug || a.id} »`;
    if (!a.id || !a.slug || !a.title) return errors.push(`${where} : id, slug et titre obligatoires`);
    if (!/^[a-z0-9-]+$/.test(a.slug)) return errors.push(`${where} : slug invalide`);
    if (!STATUSES.includes(a.status)) return errors.push(`${where} : statut inconnu « ${a.status} »`);
    if (!TYPES.includes(a.type)) return errors.push(`${where} : type inconnu « ${a.type} »`);
    if (["publie", "programme"].includes(a.status) && !a.publishedAt) return errors.push(`${where} : statut ${a.status} sans publishedAt`);
    if (a.category && !catSlugs.has(a.category)) return errors.push(`${where} : rubrique inconnue « ${a.category} »`);
    if (a.authorId && !authorIds.has(a.authorId)) return errors.push(`${where} : auteur inconnu « ${a.authorId} »`);

    const cols = ["slug", "status", "type", "sponsored", "featured", "urgent", "recommended", "category_slug", "subcategory",
      "author_id", "author_name", "reading_time", "published_at"];
    q.push({
      label: `${where} (${a.status})`,
      text: `INSERT INTO articles (id, ${cols.join(", ")}, original_lang)
             VALUES ($1, $2, $3::article_status, $4::article_type, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'fr')
             ${conflict("id", cols)}`,
      params: [a.id, a.slug, a.status, a.type, !!a.sponsored, !!a.featured, !!a.urgent, !!a.recommended,
        blank(a.category), blank(a.subcategory), blank(a.authorId), blank(a.authorName), blank(a.readingTime), blank(a.publishedAt)],
    });

    // Texte original (français) : c'est la source, donc considéré comme relu.
    const seo = a.seo || {};
    const tcols = ["kicker", "title", "excerpt", "content", "seo_title", "seo_description", "og_image_url"];
    q.push({
      label: `${where} — texte fr`,
      text: `INSERT INTO article_translations (article_id, lang, ${tcols.join(", ")}, reviewed)
             VALUES ($1, 'fr', $2, $3, $4, $5, $6, $7, $8, true)
             ${update ? `ON CONFLICT (article_id, lang) DO UPDATE SET ${tcols.map((c) => `${c} = EXCLUDED.${c}`).join(", ")}` : "ON CONFLICT (article_id, lang) DO NOTHING"}`,
      params: [a.id, blank(a.kicker), a.title, blank(a.excerpt), a.content || "", blank(seo.title), blank(seo.description), blank(seo.ogImage)],
    });

    // Image principale : créée seulement si l'article n'en a pas encore.
    const img = a.mainImage || {};
    if (blank(img.url)) {
      q.push({
        label: `${where} — image principale`,
        text: `WITH m AS (
                 INSERT INTO media (url, alt, caption, credit)
                 SELECT $2, $3, $4, $5 WHERE EXISTS (SELECT 1 FROM articles WHERE id = $1 AND main_media_id IS NULL)
                 RETURNING id)
               UPDATE articles SET main_media_id = m.id FROM m WHERE articles.id = $1`,
        params: [a.id, img.url, img.alt || "", blank(img.caption), blank(img.credit)],
      });
    }

    (a.tags || []).forEach((t) => q.push({
      label: `${where} — tag ${slugify(t)}`,
      text: `INSERT INTO article_tags (article_id, tag_slug) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      params: [a.id, slugify(t)],
    }));

    // Sources et correction : insérées une seule fois (aucune clé naturelle).
    (a.sources || []).forEach((s, i) => {
      if (!s.name) return errors.push(`${where} : source sans nom`);
      q.push({
        label: `${where} — source ${i + 1}`,
        text: `INSERT INTO article_sources (article_id, position, name, url, description)
               SELECT $1, $2, $3, $4, $5 WHERE NOT EXISTS (SELECT 1 FROM article_sources WHERE article_id = $1 AND position = $2)`,
        params: [a.id, i, s.name, blank(s.url), blank(s.description)],
      });
      counts.sources++;
    });
    if (a.correction && blank(a.correction.text)) {
      q.push({
        label: `${where} — correction`,
        text: `INSERT INTO corrections (article_id, text, corrected_at)
               SELECT $1, $2, COALESCE($3::timestamptz, now()) WHERE NOT EXISTS (SELECT 1 FROM corrections WHERE article_id = $1 AND text = $2)`,
        params: [a.id, a.correction.text, blank(a.correction.date)],
      });
      counts.corrections++;
    }
    counts.articles++;
  });

  return { q, errors, counts };
}

/* Rendu SQL littéral (uniquement pour --print-sql ; l'import normal reste paramétré). */
function literal(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}
function inline(text, params) {
  return text.replace(/\$(\d+)/g, (_, n) => literal(params[Number(n) - 1])).replace(/\s+\n\s*/g, " ");
}

async function main() {
  const args = process.argv.slice(2);
  const { q, errors, counts } = buildPlan({ update: args.includes("--update") });

  if (errors.length) {
    console.error("❌ Données invalides — rien n'a été importé :");
    errors.forEach((e) => console.error("   • " + e));
    process.exit(1);
  }
  if (args.includes("--print-sql")) {
    console.log(JSON.stringify(q.map((x) => inline(x.text, x.params))));
    return;
  }
  console.log("Plan d'import :", Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(", "));
  if (args.includes("--dry-run")) { q.forEach((x) => console.log("  · " + x.label)); return; }

  if (!process.env.DATABASE_URL) { console.error("❌ DATABASE_URL absente (voir .env.example)."); process.exit(1); }
  const { neon } = require("@neondatabase/serverless");
  const sql = neon(process.env.DATABASE_URL);
  await sql.transaction(q.map((x) => sql.query(x.text, x.params)));
  console.log(`✅ Import terminé (${q.length} instructions, une seule transaction).`);
}

if (require.main === module) main().catch((e) => { console.error("❌ Échec :", e.message); process.exit(1); });
module.exports = { buildPlan };
