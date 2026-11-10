"use strict";
/** Logique métier des articles pour l'API d'administration. */
const { getDb } = require("./db");
const { HttpError } = require("./http");
const v = require("./validate");
const { cleanHtml, plainText } = require("./sanitize");
const { can, audit } = require("./auth");
const { triggerRebuild } = require("./deploy-hook");

const LANGS = ["fr", "en"];
const TYPES = ["information", "opinion", "tribune", "editorial", "analyse"];
const slugify = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 100);

const text = (val, max) => {
  const t = plainText(v.clean(val));
  if (t.length > max) throw new HttpError(400, `Texte trop long (${max} caractères maximum).`);
  return t || null;
};

async function load(id) {
  const db = getDb();
  const rows = await db.query(
    `SELECT a.*, au.user_id AS author_user_id,
            m.url AS img_url, m.alt AS img_alt, m.caption AS img_caption, m.credit AS img_credit
     FROM articles a
     LEFT JOIN authors au ON au.id = a.author_id
     LEFT JOIN media m ON m.id = a.main_media_id
     WHERE a.id = $1`, [id]);
  if (!rows.length) throw new HttpError(404, "Article introuvable.");
  return rows[0];
}

const isOwner = (s, a) => a.created_by === s.user.id || (a.author_user_id && a.author_user_id === s.user.id);

/** Peut modifier le contenu de cet article ? */
function canEdit(s, a) {
  if (can(s, "article.edit_any")) return true;
  return can(s, "article.edit_own") && isOwner(s, a) && a.status === "brouillon";
}
const canView = (s, a) => can(s, "article.edit_any") || can(s, "article.publish") || can(s, "article.sponsor") || isOwner(s, a);

async function list(s, q) {
  const db = getDb();
  const params = [];
  const where = [];
  if (!(can(s, "article.edit_any") || can(s, "article.publish") || can(s, "article.sponsor"))) {
    if (!can(s, "article.edit_own")) throw new HttpError(403, "Vous n'avez pas accès aux articles.");
    params.push(s.user.id);
    where.push(`(a.created_by = $${params.length} OR au.user_id = $${params.length})`);
  }
  if (q.status) { params.push(v.oneOf(q, "status", ["brouillon", "programme", "publie", "archive"])); where.push(`a.status = $${params.length}::article_status`); }
  if (q.q) { params.push(`%${v.clean(q.q).slice(0, 100)}%`); where.push(`(t.title ILIKE $${params.length} OR a.slug ILIKE $${params.length})`); }
  const lim = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 100);
  const off = Math.max(parseInt(q.offset, 10) || 0, 0);
  params.push(lim, off);
  return db.query(
    `SELECT a.id, a.slug, a.status, a.type, a.sponsored, a.category_slug AS category, a.published_at, a.updated_at,
            t.title, COALESCE(au.name, a.author_name) AS author,
            (SELECT array_agg(lang::text ORDER BY lang) FROM article_translations x WHERE x.article_id = a.id) AS langs
     FROM articles a
     LEFT JOIN article_translations t ON t.article_id = a.id AND t.lang = a.original_lang
     LEFT JOIN authors au ON au.id = a.author_id
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY a.updated_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
}

async function get(s, id) {
  const db = getDb();
  const a = await load(id);
  if (!canView(s, a)) throw new HttpError(403, "Vous n'avez pas accès à cet article.");
  const [translations, tags, sources, corrections] = await Promise.all([
    db.query("SELECT lang, kicker, title, excerpt, content, seo_title, seo_description, og_image_url, reviewed, updated_at FROM article_translations WHERE article_id = $1", [id]),
    db.query("SELECT t.slug, t.label FROM article_tags at JOIN tags t ON t.slug = at.tag_slug WHERE at.article_id = $1 ORDER BY t.label", [id]),
    db.query("SELECT name, url, description FROM article_sources WHERE article_id = $1 ORDER BY position", [id]),
    db.query("SELECT id, text, corrected_at FROM corrections WHERE article_id = $1 ORDER BY corrected_at DESC", [id]),
  ]);
  return {
    id: a.id, slug: a.slug, status: a.status, type: a.type, sponsored: a.sponsored, featured: a.featured,
    urgent: a.urgent, recommended: a.recommended, category: a.category_slug, subcategory: a.subcategory,
    authorId: a.author_id, authorName: a.author_name, originalLang: a.original_lang, readingTime: a.reading_time,
    publishedAt: a.published_at, createdAt: a.created_at, updatedAt: a.updated_at,
    mainImage: a.img_url ? { url: a.img_url, alt: a.img_alt, caption: a.img_caption, credit: a.img_credit } : null,
    translations: Object.fromEntries(translations.map((t) => [t.lang, t])),
    tags, sources, corrections,
    rights: { edit: canEdit(s, a), publish: can(s, "article.publish"), archive: can(s, "article.archive"),
      sponsor: can(s, "article.sponsor"), delete: can(s, "article.delete"), correct: can(s, "correction.manage") },
  };
}

async function uniqueSlug(base, exceptId = null) {
  const db = getDb();
  let candidate = base || "article";
  for (let i = 2; i < 200; i++) {
    const r = await db.query("SELECT 1 FROM articles WHERE slug = $1 AND ($2::text IS NULL OR id <> $2)", [candidate, exceptId]);
    if (!r.length) return candidate;
    candidate = `${base}-${i}`;
  }
  throw new HttpError(409, "Impossible de générer un slug unique.");
}

async function create(s, body) {
  const title = text(body.title, 300);
  if (!title) throw new HttpError(400, "Le titre est obligatoire.", { field: "title" });
  const type = v.oneOf(body, "type", TYPES, { required: false, label: "Type" }) || "information";
  const category = body.category ? v.slug(body, "category") : null;
  const slug = await uniqueSlug(body.slug ? v.slug(body, "slug") : slugify(title));
  const db = getDb();
  const [[row]] = await db.transaction([
    { text: `INSERT INTO articles (slug, type, category_slug, created_by, updated_by) VALUES ($1, $2::article_type, $3, $4, $4) RETURNING id`,
      params: [slug, type, category, s.user.id] },
  ]);
  await db.query(
    `INSERT INTO article_translations (article_id, lang, title, content, reviewed, translated_by) VALUES ($1, 'fr', $2, '', true, $3)`,
    [row.id, title, s.user.id]);
  await audit(s.user.id, "article.creation", "article", row.id, { slug });
  return get(s, row.id);
}

async function update(s, id, body) {
  const db = getDb();
  const a = await load(id);
  if (!canEdit(s, a)) {
    throw new HttpError(403, a.status !== "brouillon" && can(s, "article.edit_own")
      ? "Cet article n'est plus un brouillon : seule l'équipe d'édition peut le modifier."
      : "Vous n'avez pas les droits pour modifier cet article.");
  }
  const qs = [];
  const set = [];
  const params = [id, s.user.id];
  const add = (col, val, cast = "") => { params.push(val); set.push(`${col} = $${params.length}${cast}`); };

  if (body.slug !== undefined) add("slug", await uniqueSlug(v.slug(body, "slug"), id));
  if (body.type !== undefined) add("type", v.oneOf(body, "type", TYPES, { label: "Type" }), "::article_type");
  if (body.category !== undefined) add("category_slug", body.category ? v.slug(body, "category") : null);
  if (body.subcategory !== undefined) add("subcategory", text(body.subcategory, 100));
  if (body.authorId !== undefined) add("author_id", body.authorId ? v.slug(body, "authorId") : null);
  if (body.authorName !== undefined) add("author_name", text(body.authorName, 150));
  if (body.readingTime !== undefined) {
    const n = body.readingTime === null || body.readingTime === "" ? null : parseInt(body.readingTime, 10);
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > 180)) throw new HttpError(400, "Temps de lecture invalide.");
    add("reading_time", n);
  }
  // Mise en avant : décision éditoriale réservée à qui peut publier.
  for (const [k, col] of [["featured", "featured"], ["urgent", "urgent"], ["recommended", "recommended"]]) {
    if (body[k] !== undefined) {
      if (!can(s, "article.publish")) throw new HttpError(403, "La mise en avant est réservée à la rédaction en chef.");
      add(col, Boolean(body[k]));
    }
  }
  qs.push({ text: `UPDATE articles SET ${set.concat("updated_by = $2").join(", ")} WHERE id = $1`, params });

  // Textes par langue
  if (body.translations && typeof body.translations === "object") {
    for (const [lang, t] of Object.entries(body.translations)) {
      if (!LANGS.includes(lang) || !t || typeof t !== "object") throw new HttpError(400, `Langue non prise en charge : ${lang}.`);
      const title = text(t.title, 300);
      if (!title) throw new HttpError(400, `Titre manquant pour la version ${lang}.`, { field: `translations.${lang}.title` });
      const content = cleanHtml(t.content);
      if (content.length > 200000) throw new HttpError(400, "Contenu trop long.");
      // Version originale = source (relue par définition). Traduction : validée seulement par l'équipe d'édition.
      const reviewed = lang === a.original_lang ? true : (Boolean(t.reviewed) && can(s, "translation.edit"));
      qs.push({
        text: `INSERT INTO article_translations (article_id, lang, kicker, title, excerpt, content, seo_title, seo_description, og_image_url, reviewed, translated_by)
               VALUES ($1, $2::lang_code, $3, $4, $5, $6, $7, $8, $9, $10, $11)
               ON CONFLICT (article_id, lang) DO UPDATE SET kicker = EXCLUDED.kicker, title = EXCLUDED.title, excerpt = EXCLUDED.excerpt,
                 content = EXCLUDED.content, seo_title = EXCLUDED.seo_title, seo_description = EXCLUDED.seo_description,
                 og_image_url = EXCLUDED.og_image_url, reviewed = EXCLUDED.reviewed, translated_by = EXCLUDED.translated_by`,
        params: [id, lang, text(t.kicker, 120), title, text(t.excerpt, 600), content, text(t.seoTitle, 120), text(t.seoDescription, 300),
          t.ogImage ? v.url({ u: t.ogImage }, "u", { label: "Image de partage" }) : null, reviewed, s.user.id],
      });
    }
  }

  // Tags (remplace la liste de cet article uniquement)
  if (Array.isArray(body.tags)) {
    if (body.tags.length > 20) throw new HttpError(400, "20 tags maximum.");
    qs.push({ text: "DELETE FROM article_tags WHERE article_id = $1", params: [id] });
    for (const label of body.tags) {
      const l = text(label, 60); const sl = slugify(l);
      if (!sl) continue;
      qs.push({ text: "INSERT INTO tags (slug, label) VALUES ($1, $2) ON CONFLICT (slug) DO NOTHING", params: [sl, l] });
      qs.push({ text: "INSERT INTO article_tags (article_id, tag_slug) VALUES ($1, $2) ON CONFLICT DO NOTHING", params: [id, sl] });
    }
  }

  // Sources (remplace la liste de cet article uniquement)
  if (Array.isArray(body.sources)) {
    if (body.sources.length > 30) throw new HttpError(400, "30 sources maximum.");
    qs.push({ text: "DELETE FROM article_sources WHERE article_id = $1", params: [id] });
    body.sources.forEach((src, i) => {
      const name = text(src && src.name, 200);
      if (!name) throw new HttpError(400, `Source n° ${i + 1} : nom obligatoire.`);
      qs.push({ text: "INSERT INTO article_sources (article_id, position, name, url, description) VALUES ($1, $2, $3, $4, $5)",
        params: [id, i, name, src.url ? v.url(src, "url", { label: "Lien de la source" }) : null, text(src.description, 300)] });
    });
  }

  // Image principale
  if (body.mainImage !== undefined) {
    const img = body.mainImage;
    if (!img || !img.url) {
      qs.push({ text: "UPDATE articles SET main_media_id = NULL WHERE id = $1", params: [id] });
    } else {
      const raw = String(img.url).trim();
      let url;
      if (/^\/media\/[0-9a-f-]{36}$/i.test(raw)) {
        // image téléversée sur ce site : elle doit exister
        const ok = await db.query("SELECT 1 FROM media_files WHERE media_id = $1", [raw.slice(7).toLowerCase()]).catch(() => []);
        if (!ok.length) throw new HttpError(400, "Image introuvable dans la médiathèque.", { field: "mainImage.url" });
        url = raw.toLowerCase();
      } else {
        url = v.url(img, "url", { required: true, label: "Image principale" });
        if (!url.startsWith("https://")) throw new HttpError(400, "L'image doit être servie en HTTPS (ou téléversée depuis l'appareil).");
      }
      const alt = text(img.alt, 300);
      if (!alt) throw new HttpError(400, "Le texte alternatif de l'image est obligatoire (accessibilité).", { field: "mainImage.alt" });
      qs.push({
        text: `WITH m AS (INSERT INTO media (url, alt, caption, credit, uploaded_by) VALUES ($2, $3, $4, $5, $6) RETURNING id)
               UPDATE articles SET main_media_id = m.id FROM m WHERE articles.id = $1`,
        params: [id, url, alt, text(img.caption, 300), text(img.credit, 150), s.user.id],
      });
    }
  }

  await db.transaction(qs);
  await audit(s.user.id, "article.modification", "article", id, { champs: Object.keys(body) });
  if (a.status === "publie") await triggerRebuild(`modification ${a.slug}`);
  return get(s, id);
}

async function setStatus(s, id, body) {
  const status = v.oneOf(body, "status", ["brouillon", "programme", "publie", "archive"], { label: "Statut" });
  const need = status === "archive" ? "article.archive" : "article.publish";
  if (!can(s, need)) throw new HttpError(403, "Vous n'avez pas les droits pour changer ce statut.");
  const a = await load(id);
  const db = getDb();

  let publishedAt = a.published_at;
  if (status === "publie" || status === "programme") {
    // Mêmes exigences pour un article programmé : il sera publié automatiquement.
    const fr = (await db.query("SELECT title, content FROM article_translations WHERE article_id = $1 AND lang = $2", [id, a.original_lang]))[0];
    if (!fr || !fr.title || !plainText(fr.content)) throw new HttpError(400, "Impossible de publier : le titre et le contenu sont obligatoires.");
    if (!a.category_slug) throw new HttpError(400, "Impossible de publier : choisissez une rubrique.");
    if (!a.author_id && !a.author_name) throw new HttpError(400, "Impossible de publier : indiquez l'auteur ou la signature.");
  }
  if (status === "publie") {
    const when = v.dateTime(body, "publishedAt");
    if (when && new Date(when) > new Date(Date.now() + 60000)) throw new HttpError(400, "Date future : utilisez « programmer ».");
    publishedAt = when || (a.status === "archive" && a.published_at) || new Date().toISOString();
  } else if (status === "programme") {
    const when = v.dateTime(body, "publishedAt", { required: true, label: "Date de publication" });
    if (new Date(when) <= new Date()) throw new HttpError(400, "La date de programmation doit être dans le futur.");
    publishedAt = when;
  }

  await db.query("UPDATE articles SET status = $2::article_status, published_at = $3, updated_by = $4 WHERE id = $1",
    [id, status, publishedAt, s.user.id]);
  await audit(s.user.id, `article.statut.${status}`, "article", id, { avant: a.status, publishedAt });
  // Rebuild si la partie publique change (publication, dépublication, archivage).
  const rebuilt = (status === "publie" || a.status === "publie") ? await triggerRebuild(`statut ${a.slug} → ${status}`) : false;
  return { ...(await get(s, id)), rebuildTriggered: rebuilt };
}

async function setSponsored(s, id, body) {
  if (!can(s, "article.sponsor")) throw new HttpError(403, "Vous n'avez pas les droits pour cette action.");
  const a = await load(id);
  const sponsored = body.sponsored === true || body.sponsored === "true";
  await getDb().query("UPDATE articles SET sponsored = $2, updated_by = $3 WHERE id = $1", [id, sponsored, s.user.id]);
  await audit(s.user.id, "article.sponsorise", "article", id, { sponsored });
  if (a.status === "publie") await triggerRebuild(`sponsorisé ${a.slug}`);
  return get(s, id);
}

async function addCorrection(s, id, body) {
  if (!can(s, "correction.manage")) throw new HttpError(403, "Vous n'avez pas les droits pour publier une correction.");
  const a = await load(id);
  const t = text(body.text, 1000);
  if (!t) throw new HttpError(400, "Le texte de la correction est obligatoire.", { field: "text" });
  await getDb().query("INSERT INTO corrections (article_id, text, created_by) VALUES ($1, $2, $3)", [id, t, s.user.id]);
  await audit(s.user.id, "article.correction", "article", id);
  if (a.status === "publie") await triggerRebuild(`correction ${a.slug}`);
  return get(s, id);
}

async function remove(s, id) {
  if (!can(s, "article.delete")) throw new HttpError(403, "Seul un administrateur peut supprimer définitivement un article.");
  const a = await load(id);
  await getDb().query("DELETE FROM articles WHERE id = $1", [id]);
  await audit(s.user.id, "article.suppression", "article", id, { slug: a.slug, statut: a.status });
  if (a.status === "publie") await triggerRebuild(`suppression ${a.slug}`);
  return { ok: true };
}

module.exports = { list, get, create, update, setStatus, setSponsored, addCorrection, remove, slugify };
