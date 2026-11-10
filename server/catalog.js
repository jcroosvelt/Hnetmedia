"use strict";
/**
 * Contenus d'équipe et de site gérés depuis /admin : auteurs (équipe), partenaires, offres d'emploi,
 * réglages du site. Chaque changement visible du public relance la construction du site.
 * Textes enregistrés en texte brut (balises retirées) ; échappement à l'affichage.
 */
const { getDb } = require("./db");
const { HttpError } = require("./http");
const v = require("./validate");
const { plainText } = require("./sanitize");
const { audit } = require("./auth");
const { triggerRebuild } = require("./deploy-hook");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEDIA_RE = /^\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOCIAL_KEYS = ["twitter", "facebook", "linkedin", "youtube", "instagram"];
const LEGAL_KEYS = ["publisherName", "publisherAddress", "director", "registration", "hostName", "hostAddress"];
const slugify = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);

/* ── validations communes ── */
function text(val, max, label, { required = false } = {}) {
  const t = plainText(v.clean(val, true));
  if (!t) { if (required) throw new HttpError(400, `Le champ « ${label} » est obligatoire.`); return null; }
  if (t.length > max) throw new HttpError(400, `Le champ « ${label} » est trop long (${max} caractères maximum).`);
  return t;
}
function httpsUrl(val, label) {
  const raw = v.clean(val);
  if (!raw) return null;
  const u = v.url({ u: raw }, "u", { label });
  if (!u.startsWith("https://")) throw new HttpError(400, `Le lien « ${label} » doit commencer par https://`);
  return u;
}
async function imageRef(val, label) {
  const raw = v.clean(val);
  if (!raw) return null;
  if (MEDIA_RE.test(raw)) {
    const ok = await getDb().query("SELECT 1 FROM media_files WHERE media_id = $1", [raw.slice(7).toLowerCase()]);
    if (!ok.length) throw new HttpError(400, `${label} : image introuvable dans la médiathèque.`);
    return raw.toLowerCase();
  }
  return httpsUrl(raw, label);
}
const bool = (x, dflt) => (x === undefined ? dflt : x === true || x === "true" || x === 1 || x === "1");
const changed = (reason) => triggerRebuild(reason);

/* ═════════ ÉQUIPE (auteurs) ═════════ */
function socialMap(obj) {
  const out = {};
  if (obj && typeof obj === "object") for (const k of SOCIAL_KEYS) { const u = httpsUrl(obj[k], `Lien ${k}`); if (u) out[k] = u; }
  return out;
}
const authors = {
  async list() {
    return getDb().query(`SELECT a.id, a.name, a.role, a.bio, a.photo_url AS photo, a.social,
        (SELECT count(*)::int FROM articles x WHERE x.author_id = a.id) AS articles
      FROM authors a ORDER BY a.name`);
  },
  async create(s, b) {
    const name = text(b.name, 100, "Nom", { required: true });
    const base = slugify(name) || "auteur";
    const db = getDb();
    let id = base;
    for (let i = 2; i < 100 && (await db.query("SELECT 1 FROM authors WHERE id = $1", [id])).length; i++) id = `${base}-${i}`.slice(0, 60);
    await db.query(`INSERT INTO authors (id, name, role, bio, photo_url, social) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [id, name, text(b.role, 120, "Fonction"), text(b.bio, 1500, "Présentation"), await imageRef(b.photo, "Photo"), JSON.stringify(socialMap(b.social))]);
    await audit(s.user.id, "equipe.creation", "author", id, { name });
    await changed(`fiche équipe ${id}`);
    return { id };
  },
  async update(s, id, b) {
    if (!/^[a-z0-9-]{1,60}$/.test(id)) throw new HttpError(404, "Fiche introuvable.");
    const r = await getDb().query(`UPDATE authors SET name = $2, role = $3, bio = $4, photo_url = $5, social = $6::jsonb WHERE id = $1 RETURNING id`,
      [id, text(b.name, 100, "Nom", { required: true }), text(b.role, 120, "Fonction"), text(b.bio, 1500, "Présentation"), await imageRef(b.photo, "Photo"), JSON.stringify(socialMap(b.social))]);
    if (!r.length) throw new HttpError(404, "Fiche introuvable.");
    await audit(s.user.id, "equipe.modification", "author", id);
    await changed(`fiche équipe ${id}`);
    return { id };
  },
  async remove(s, id) {
    if (!/^[a-z0-9-]{1,60}$/.test(id)) throw new HttpError(404, "Fiche introuvable.");
    const db = getDb();
    const n = (await db.query("SELECT count(*)::int AS n FROM articles WHERE author_id = $1", [id]))[0].n;
    if (n > 0) throw new HttpError(409, `Cette personne est signataire de ${n} article${n > 1 ? "s" : ""} : changez d'abord leur signature avant de supprimer la fiche.`);
    const r = await db.query("DELETE FROM authors WHERE id = $1 RETURNING id", [id]);
    if (!r.length) throw new HttpError(404, "Fiche introuvable.");
    await audit(s.user.id, "equipe.suppression", "author", id);
    await changed(`fiche équipe supprimée ${id}`);
    return { ok: true };
  },
};

/* ═════════ PARTENAIRES ═════════ */
const KINDS = ["partenaire", "annonceur", "institution"];
function partnerFields(b) {
  const pos = b.position === undefined || b.position === "" ? 0 : parseInt(b.position, 10);
  if (!Number.isInteger(pos) || pos < 0 || pos > 999) throw new HttpError(400, "L'ordre d'affichage doit être un nombre entre 0 et 999.");
  return [text(b.name, 120, "Nom", { required: true }), httpsUrl(b.url, "Site web"), text(b.description, 500, "Description"),
    v.oneOf({ k: b.kind || "partenaire" }, "k", KINDS, { label: "Type" }), bool(b.active, true), pos];
}
const partners = {
  async list() {
    return getDb().query(`SELECT id, name, url, description, kind, active, position FROM partners ORDER BY position, name`);
  },
  async create(s, b) {
    const f = partnerFields(b);
    const r = await getDb().query(`INSERT INTO partners (name, url, description, kind, active, position) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, f);
    await audit(s.user.id, "partenaire.creation", "partner", r[0].id, { name: f[0] });
    await changed(`partenaire ${f[0]}`);
    return { id: r[0].id };
  },
  async update(s, id, b) {
    if (!UUID_RE.test(id)) throw new HttpError(404, "Partenaire introuvable.");
    const r = await getDb().query(`UPDATE partners SET name = $2, url = $3, description = $4, kind = $5, active = $6, position = $7 WHERE id = $1 RETURNING id`, [id, ...partnerFields(b)]);
    if (!r.length) throw new HttpError(404, "Partenaire introuvable.");
    await audit(s.user.id, "partenaire.modification", "partner", id);
    await changed(`partenaire ${id}`);
    return { id };
  },
  async remove(s, id) {
    if (!UUID_RE.test(id)) throw new HttpError(404, "Partenaire introuvable.");
    const r = await getDb().query("DELETE FROM partners WHERE id = $1 RETURNING id", [id]);
    if (!r.length) throw new HttpError(404, "Partenaire introuvable.");
    await audit(s.user.id, "partenaire.suppression", "partner", id);
    await changed(`partenaire supprimé ${id}`);
    return { ok: true };
  },
};

/* ═════════ OFFRES D'EMPLOI ═════════ */
const JOB_STATUS = ["brouillon", "ouvert", "ferme"];
function jobFields(b) {
  const status = v.oneOf({ s: b.status || "brouillon" }, "s", JOB_STATUS, { label: "Statut" });
  const applyEmail = v.clean(b.applyEmail) ? v.email({ e: b.applyEmail }, "e", "E-mail de candidature") : null;
  const applyUrl = httpsUrl(b.applyUrl, "Lien de candidature");
  if (status === "ouvert" && !applyEmail && !applyUrl) throw new HttpError(400, "Pour ouvrir une offre, indiquez comment postuler (e-mail ou lien).");
  return {
    status, applyEmail, applyUrl,
    title: text(b.title, 150, "Intitulé", { required: true }), contract: text(b.contract, 60, "Contrat"), location: text(b.location, 100, "Lieu"),
    description: text(b.description, 4000, "Description", { required: true }), closesAt: v.dateTime({ d: b.closesAt }, "d", { label: "Date limite" }),
  };
}
const jobs = {
  async list() {
    return getDb().query(`SELECT id, slug, title, contract, location, description, apply_url AS "applyUrl", apply_email AS "applyEmail", status::text AS status,
      published_at AS "publishedAt", closes_at AS "closesAt" FROM jobs ORDER BY (status = 'ouvert') DESC, created_at DESC`);
  },
  async create(s, b) {
    const f = jobFields(b);
    const db = getDb();
    const base = slugify(f.title) || "offre";
    let slug = base;
    for (let i = 2; i < 100 && (await db.query("SELECT 1 FROM jobs WHERE slug = $1", [slug])).length; i++) slug = `${base}-${i}`.slice(0, 60);
    const r = await db.query(`INSERT INTO jobs (slug, title, contract, location, description, apply_url, apply_email, status, published_at, closes_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text::job_status, CASE WHEN $8::text = 'ouvert' THEN now() END, $9) RETURNING id`,
      [slug, f.title, f.contract, f.location, f.description, f.applyUrl, f.applyEmail, f.status, f.closesAt]);
    await audit(s.user.id, "offre.creation", "job", r[0].id, { title: f.title, status: f.status });
    await changed(`offre ${slug}`);
    return { id: r[0].id };
  },
  async update(s, id, b) {
    if (!UUID_RE.test(id)) throw new HttpError(404, "Offre introuvable.");
    const f = jobFields(b);
    const r = await getDb().query(`UPDATE jobs SET title = $2, contract = $3, location = $4, description = $5, apply_url = $6, apply_email = $7,
        status = $8::text::job_status, published_at = CASE WHEN $8::text = 'ouvert' AND published_at IS NULL THEN now() ELSE published_at END, closes_at = $9
      WHERE id = $1 RETURNING id`, [id, f.title, f.contract, f.location, f.description, f.applyUrl, f.applyEmail, f.status, f.closesAt]);
    if (!r.length) throw new HttpError(404, "Offre introuvable.");
    await audit(s.user.id, "offre.modification", "job", id, { status: f.status });
    await changed(`offre ${id}`);
    return { id };
  },
  async remove(s, id) {
    if (!UUID_RE.test(id)) throw new HttpError(404, "Offre introuvable.");
    const r = await getDb().query("DELETE FROM jobs WHERE id = $1 RETURNING id", [id]);
    if (!r.length) throw new HttpError(404, "Offre introuvable.");
    await audit(s.user.id, "offre.suppression", "job", id);
    await changed(`offre supprimée ${id}`);
    return { ok: true };
  },
};

/* ═════════ RUBRIQUES (libellés FR/EN, description, ordre) ═════════ */
const categories = {
  async list() {
    return getDb().query(`SELECT slug, label, label_en AS "labelEn", description, description_en AS "descriptionEn", icon, position FROM categories ORDER BY position, slug`);
  },
  // L'adresse (slug) d'une rubrique ne change jamais : elle sert d'URL et de lien dans les articles.
  async update(s, slug, b) {
    if (!/^[a-z0-9-]{1,60}$/.test(slug)) throw new HttpError(404, "Rubrique introuvable.");
    const label = text(b.label, 40, "Nom (français)", { required: true });
    if (label.length < 2) throw new HttpError(400, "Le nom de la rubrique doit faire au moins 2 caractères.");
    const pos = b.position === undefined || b.position === "" ? 0 : parseInt(b.position, 10);
    if (!Number.isInteger(pos) || pos < 0 || pos > 99) throw new HttpError(400, "L'ordre d'affichage doit être un nombre entre 0 et 99.");
    const r = await getDb().query(
      `UPDATE categories SET label = $2, label_en = $3, description = $4, description_en = $5, position = $6 WHERE slug = $1 RETURNING slug`,
      [slug, label, text(b.labelEn, 40, "Nom (anglais)"), text(b.description, 300, "Description (français)"), text(b.descriptionEn, 300, "Description (anglais)"), pos]);
    if (!r.length) throw new HttpError(404, "Rubrique introuvable.");
    await audit(s.user.id, "rubrique.modification", "category", slug);
    await changed(`rubrique ${slug}`);
    return { slug };
  },
};

/* ═════════ RÉGLAGES DU SITE ═════════ */
const settings = {
  async get() {
    const rows = await getDb().query("SELECT key, value FROM site_settings WHERE key IN ('siteName','tagline','description','taglineEn','descriptionEn','footerText','footerTextEn','social','legal','contactCategories')");
    const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return {
      siteName: m.siteName || "", tagline: m.tagline || "", description: m.description || "", footerText: typeof m.footerText === "string" ? m.footerText : "",
      taglineEn: typeof m.taglineEn === "string" ? m.taglineEn : "", descriptionEn: typeof m.descriptionEn === "string" ? m.descriptionEn : "", footerTextEn: typeof m.footerTextEn === "string" ? m.footerTextEn : "",
      social: Object.assign(Object.fromEntries(SOCIAL_KEYS.map((k) => [k, ""])), m.social || {}),
      legal: Object.assign(Object.fromEntries(LEGAL_KEYS.map((k) => [k, ""])), m.legal || {}),
      contactCategories: Array.isArray(m.contactCategories) ? m.contactCategories : [],
    };
  },
  async save(s, b) {
    const siteName = text(b.siteName, 80, "Nom du site", { required: true });
    const tagline = text(b.tagline, 120, "Slogan", { required: true });
    const description = text(b.description, 300, "Description du site", { required: true });
    const footerText = text(b.footerText, 300, "Texte du pied de page");
    // Version anglaise (facultative) : vide = traduction d'origine du site.
    const en = { taglineEn: text(b.taglineEn, 120, "Slogan (anglais)"), descriptionEn: text(b.descriptionEn, 300, "Description (anglais)"), footerTextEn: text(b.footerTextEn, 300, "Pied de page (anglais)") };
    const social = socialMap(b.social);
    const legal = {};
    for (const k of LEGAL_KEYS) { const t = text(b.legal && b.legal[k], k.endsWith("Address") ? 300 : 200, "Mentions légales"); if (t) legal[k] = t; }
    let cats = Array.isArray(b.contactCategories) ? b.contactCategories : String(b.contactCategories || "").split("\n");
    cats = cats.map((c) => plainText(v.clean(c))).filter(Boolean);
    if (cats.length < 1 || cats.length > 12) throw new HttpError(400, "Indiquez de 1 à 12 types de demande pour le formulaire de contact.");
    const seen = new Set();
    for (const c of cats) {
      if (c.length < 2 || c.length > 40) throw new HttpError(400, `Type de demande « ${c.slice(0, 20)}… » : de 2 à 40 caractères.`);
      if (seen.has(c.toLowerCase())) throw new HttpError(400, `Type de demande en double : « ${c} ».`);
      seen.add(c.toLowerCase());
    }
    const up = (k, val) => ({ text: `INSERT INTO site_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, params: [k, JSON.stringify(val)] });
    // Texte du pied de page facultatif : vide = texte d'origine du site (la ligne est supprimée).
    const optional = (k, val) => (val ? up(k, val) : { text: "DELETE FROM site_settings WHERE key = $1", params: [k] });
    await getDb().transaction([up("siteName", siteName), up("tagline", tagline), up("description", description), optional("footerText", footerText),
      optional("taglineEn", en.taglineEn), optional("descriptionEn", en.descriptionEn), optional("footerTextEn", en.footerTextEn), up("social", social), up("legal", legal), up("contactCategories", cats)]);
    await audit(s.user.id, "reglages.modification", "settings", null, { reseaux: Object.keys(social).length, mentions: Object.keys(legal).length });
    await changed("réglages du site");
    return this.get();
  },
};

module.exports = { authors, partners, jobs, categories, settings, SOCIAL_KEYS, LEGAL_KEYS, MEDIA_RE };
