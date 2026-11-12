"use strict";
/**
 * Commentaires des lecteurs.
 * Règles : tout commentaire public arrive « en_attente » (pré-modération) ; seuls les « approuve » sont lus par
 * le site. Texte brut uniquement (affiché par textContent) ; e-mail facultatif et jamais publié ; limites anti-spam.
 */
const { getDb } = require("./db");
const { HttpError } = require("./http");
const v = require("./validate");
const { audit } = require("./auth");
const push = require("./push");

const LINK_RE = /(https?:\/\/|www\.)/gi;
const MAX_LINKS = 2;

/** Commentaires ouverts ? (réglage « commentsEnabled », ouverts par défaut) */
async function enabled() {
  const r = await getDb().query("SELECT value FROM site_settings WHERE key = 'commentsEnabled'");
  return !(r[0] && r[0].value === false);
}

/** Liste publique d'un article : commentaires approuvés, réponses imbriquées (un seul niveau). */
async function listPublic(slug) {
  const db = getDb();
  const a = await db.query("SELECT id FROM articles WHERE slug = $1 AND status = 'publie' AND published_at <= now()", [slug]);
  if (!a.length) throw new HttpError(404, "Article introuvable.");
  const rows = await db.query(
    `SELECT id, parent_id, name, body, is_staff, created_at FROM comments
     WHERE article_id = $1 AND status = 'approuve' ORDER BY created_at ASC LIMIT 500`, [a[0].id]);
  const pub = (r) => ({ id: r.id, name: r.name, body: r.body, staff: r.is_staff, createdAt: r.created_at, replies: [] });
  const top = new Map();
  for (const r of rows) if (!r.parent_id) top.set(r.id, pub(r));
  for (const r of rows) if (r.parent_id && top.has(r.parent_id)) top.get(r.parent_id).replies.push(pub(r));
  const items = [...top.values()];
  return { items, total: rows.length };
}

/** Dépôt d'un commentaire par un lecteur. Renvoie { id }. */
async function submit(body, { ipKey, userAgent }) {
  if (!(await enabled())) throw new HttpError(503, "Les commentaires sont fermés pour le moment.");
  const slug = v.str(body, "article", { max: 160, label: "Article" });
  const name = v.str(body, "name", { min: 2, max: 60, label: "Nom" });
  const text = v.str(body, "body", { min: 3, max: 2000, multiline: true, label: "Commentaire" });
  const email = body.email && String(body.email).trim() ? v.email(body, "email") : null;
  const lang = body.lang === "en" ? "en" : "fr";
  if ((text.match(LINK_RE) || []).length > MAX_LINKS) throw new HttpError(400, `Votre commentaire contient trop de liens (${MAX_LINKS} au maximum).`, { field: "body" });

  const db = getDb();
  const art = (await db.query("SELECT id, slug FROM articles WHERE slug = $1 AND status = 'publie' AND published_at <= now()", [slug]))[0];
  if (!art) throw new HttpError(404, "Article introuvable.");

  let parentId = null;
  if (body.parentId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(body.parentId))) throw new HttpError(400, "Réponse invalide.");
    const p = await db.query("SELECT id FROM comments WHERE id = $1 AND article_id = $2 AND parent_id IS NULL AND status = 'approuve'", [body.parentId, art.id]);
    if (!p.length) throw new HttpError(400, "Le commentaire auquel vous répondez n'existe plus.");
    parentId = p[0].id;
  }
  // Même texte déjà envoyé depuis cette adresse dans les dernières 24 h : refusé (doublon / robot).
  const dup = await db.query("SELECT 1 FROM comments WHERE ip_hash = $1 AND article_id = $2 AND body = $3 AND created_at > now() - interval '24 hours'", [ipKey, art.id, text]);
  if (dup.length) throw new HttpError(409, "Vous avez déjà envoyé ce commentaire.");

  const rows = await db.query(
    `INSERT INTO comments (article_id, parent_id, name, email, body, lang, ip_hash, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6::lang_code, $7, $8) RETURNING id`,
    [art.id, parentId, name, email, text, lang, ipKey, String(userAgent || "").slice(0, 300)]);
  const tr = (await db.query("SELECT title FROM article_translations t JOIN articles a ON a.id = t.article_id WHERE a.id = $1 AND t.lang = a.original_lang", [art.id]))[0];
  await push.notifyNewComment({ articleTitle: tr && tr.title, author: name, slug: art.slug });
  return { id: rows[0].id };
}

/* ── Modération (admin) ── */
const STATUSES = ["en_attente", "approuve", "refuse", "spam"];

async function listAdmin(q) {
  const params = [];
  const where = [];
  if (q.status) { params.push(v.oneOf(q, "status", STATUSES)); where.push(`c.status = $${params.length}::comment_status`); }
  if (q.article) { params.push(String(q.article).slice(0, 160)); where.push(`a.slug = $${params.length}`); }
  const lim = Math.min(Math.max(parseInt(q.limit, 10) || 100, 1), 200);
  params.push(lim);
  const db = getDb();
  const items = await db.query(
    `SELECT c.id, c.parent_id AS "parentId", c.name, c.email, c.body, c.status, c.is_staff AS staff, c.lang, c.created_at AS "createdAt",
            c.moderated_at AS "moderatedAt", a.slug AS "articleSlug", a.id AS "articleId",
            (SELECT t.title FROM article_translations t WHERE t.article_id = a.id AND t.lang = a.original_lang) AS "articleTitle",
            (SELECT p.name FROM comments p WHERE p.id = c.parent_id) AS "parentName"
     FROM comments c JOIN articles a ON a.id = c.article_id
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY (c.status = 'en_attente') DESC, c.created_at DESC LIMIT $${params.length}`, params);
  const counts = Object.fromEntries((await db.query("SELECT status::text s, count(*)::int n FROM comments GROUP BY status")).map((r) => [r.s, r.n]));
  return { items, counts };
}

async function loadOne(id) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id))) throw new HttpError(404, "Commentaire introuvable.");
  const r = (await getDb().query(
    `SELECT c.*, a.slug AS article_slug, a.created_by AS article_created_by, au.user_id AS article_author_user_id,
            (SELECT t.title FROM article_translations t WHERE t.article_id = a.id AND t.lang = a.original_lang) AS article_title
     FROM comments c JOIN articles a ON a.id = c.article_id LEFT JOIN authors au ON au.id = a.author_id WHERE c.id = $1`, [id]))[0];
  if (!r) throw new HttpError(404, "Commentaire introuvable.");
  return r;
}

async function setStatus(s, id, body) {
  const status = v.oneOf(body, "status", STATUSES, { label: "Statut" });
  const c = await loadOne(id);
  await getDb().query("UPDATE comments SET status = $2::comment_status, moderated_by = $3, moderated_at = now() WHERE id = $1", [id, status, s.user.id]);
  await audit(s.user.id, `commentaire.${status}`, "comment", id, { article: c.article_slug });
  // L'auteur de l'article est prévenu quand un commentaire est publié.
  if (status === "approuve" && c.status !== "approuve" && !c.is_staff) {
    const ids = [c.article_created_by, c.article_author_user_id].filter((x, i, a) => x && a.indexOf(x) === i);
    await push.notify({ userIds: ids, excludeUserId: s.user.id, channel: "comments", title: "Nouveau commentaire sur votre article", body: `${c.name} — ${c.article_title || c.article_slug}`, url: `/article/${c.article_slug}` });
  }
  return { ok: true };
}

/** Réponse publique de la rédaction (publiée tout de suite, sous le commentaire d'un lecteur). */
async function replyAsStaff(s, id, body) {
  const text = v.str(body, "body", { min: 3, max: 2000, multiline: true, label: "Réponse" });
  const parent = await loadOne(id);
  if (parent.parent_id) throw new HttpError(400, "On ne répond qu'à un commentaire principal.");
  if (parent.status !== "approuve") throw new HttpError(400, "Approuvez d'abord le commentaire avant d'y répondre.");
  const rows = await getDb().query(
    `INSERT INTO comments (article_id, parent_id, name, body, lang, status, is_staff, moderated_by, moderated_at)
     VALUES ($1, $2, $3, $4, $5::lang_code, 'approuve', true, $6, now()) RETURNING id`,
    [parent.article_id, parent.id, s.user.name || "La rédaction", text, parent.lang, s.user.id]);
  await audit(s.user.id, "commentaire.reponse", "comment", rows[0].id, { article: parent.article_slug });
  return { ok: true, id: rows[0].id };
}

async function remove(s, id) {
  const c = await loadOne(id);
  await getDb().query("DELETE FROM comments WHERE id = $1", [id]);
  await audit(s.user.id, "commentaire.suppression", "comment", id, { article: c.article_slug });
  return { ok: true };
}

/** Rappel unique : commentaires en attente depuis plus de 30 min (réclamés de façon atomique). */
async function remindPending() {
  if (!push.isConfigured()) return 0;
  const rows = await getDb().query(
    `UPDATE comments SET push_reminded_at = now()
     WHERE status = 'en_attente' AND push_reminded_at IS NULL AND created_at < now() - interval '30 minutes' RETURNING id`);
  if (!rows.length) return 0;
  await push.notify({
    permission: "comment.moderate", channel: "comments", title: "Rappel : commentaires à modérer",
    body: rows.length === 1 ? "1 commentaire attend votre décision." : `${rows.length} commentaires attendent votre décision.`, url: "/admin#/commentaires",
  });
  return rows.length;
}

module.exports = { enabled, listPublic, submit, listAdmin, setStatus, replyAsStaff, remove, remindPending };
