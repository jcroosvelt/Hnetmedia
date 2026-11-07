"use strict";
/**
 * API d'administration : /api/admin/<route>  (réécrit vers /api/admin?route=<route>)
 *
 * Authentification
 *   POST auth/setup        création du tout premier administrateur (ADMIN_SETUP_TOKEN, une seule fois)
 *   POST auth/login        { email, password }
 *   POST auth/logout
 *   GET  auth/session      session courante + jeton CSRF
 *   POST auth/password     { current, password }
 * Contenu
 *   GET  meta                         rubriques, tags, auteurs, rôles, mes permissions
 *   GET  articles?status=&q=          liste (limitée à ses articles selon le rôle)
 *   POST articles                     { title, category?, type? } → brouillon
 *   GET  articles/:id
 *   PUT  articles/:id                 contenu, traductions, tags, sources, image
 *   POST articles/:id/status          { status, publishedAt? }
 *   POST articles/:id/sponsored       { sponsored }
 *   POST articles/:id/corrections     { text }
 *   DELETE articles/:id
 * Relations lecteurs
 *   GET   contact-messages?status=    PATCH contact-messages/:id { status }
 *   GET   subscribers/stats           GET subscribers   GET subscribers/export (CSV)
 *   GET   stats/views?days=
 * Médiathèque
 *   GET media                         images téléversées (les siennes, ou toutes avec media.manage)
 *   POST media                        octets bruts d'une image JPEG/PNG/WebP ≤ 2 Mo → { url:"/media/<id>" }
 * Comptes
 *   GET users   POST users   PATCH users/:id
 * Toute requête qui modifie exige : session valide + en-tête X-CSRF-Token + Origin du site.
 */
const { handler, send, readBody, getQuery, HttpError } = require("../server/http");
const { getDb } = require("../server/db");
const v = require("../server/validate");
const auth = require("../server/auth");
const articles = require("../server/articles");
const media = require("../server/media");
const { checkOrigin, safeEqual, clientIp, fingerprint } = require("../server/security");
const { limit } = require("../server/ratelimit");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ARTICLE_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

function routeOf(req) {
  const q = getQuery(req);
  const r = q.route !== undefined ? q.route : new URL(req.url, "http://x").pathname.replace(/^\/api\/admin\/?/, "");
  return String(r).replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
}

/* ── Authentification ── */
async function setup(req, res) {
  checkOrigin(req);
  const expected = process.env.ADMIN_SETUP_TOKEN;
  if (!expected || expected.length < 24) throw new HttpError(404, "Introuvable.");
  await limit(`setup:${fingerprint(clientIp(req))}`, 5, 3600);
  const body = await readBody(req);
  if (!body.setupToken || !safeEqual(body.setupToken, expected)) throw new HttpError(403, "Code d'installation invalide.");
  const email = v.email(body, "email");
  const name = v.str(body, "name", { min: 2, max: 100, label: "Nom" });
  const hash = await auth.hashPassword(auth.checkPasswordPolicy(body.password));
  // Insertion uniquement si aucun compte n'existe (atomique).
  const rows = await getDb().query(
    `INSERT INTO users (email, display_name, password_hash, role_id, password_changed_at)
     SELECT $1, $2, $3, (SELECT id FROM roles WHERE code = 'administrateur'), now()
     WHERE NOT EXISTS (SELECT 1 FROM users) RETURNING id`, [email, name, hash]);
  if (!rows.length) throw new HttpError(409, "L'installation est déjà faite. Connectez-vous.");
  await auth.audit(rows[0].id, "installation.admin", "user", rows[0].id);
  send(res, 201, { ok: true, message: "Compte administrateur créé. Vous pouvez vous connecter. Supprimez ADMIN_SETUP_TOKEN dans Vercel." });
}

async function login(req, res) {
  checkOrigin(req);
  const body = await readBody(req);
  const email = v.email(body, "email");
  const password = String(body.password || "");
  if (!password || password.length > 200) throw new HttpError(401, "Identifiants incorrects.");
  const r = await auth.login(req, email, password);
  send(res, 200, { ok: true, user: r.user, csrfToken: r.csrfToken }, { "Set-Cookie": r.cookie });
}

async function logout(req, res) {
  checkOrigin(req);
  send(res, 200, { ok: true }, { "Set-Cookie": await auth.logout(req) });
}

async function session(req, res) {
  const s = await auth.getSession(req);
  if (!s) {
    const needsSetup = Boolean(process.env.ADMIN_SETUP_TOKEN) &&
      (await getDb().query("SELECT NOT EXISTS (SELECT 1 FROM users) AS empty"))[0].empty;
    return send(res, 401, { ok: false, error: "Non connecté.", needsSetup });
  }
  send(res, 200, { ok: true, user: s.user, permissions: [...s.perms].sort(), csrfToken: s.csrf });
}

async function changePassword(req, res) {
  const s = await auth.requireAuth(req);
  const body = await readBody(req);
  const row = (await getDb().query("SELECT password_hash FROM users WHERE id = $1", [s.user.id]))[0];
  if (!(await auth.verifyPassword(String(body.current || ""), row.password_hash))) throw new HttpError(400, "Mot de passe actuel incorrect.", { field: "current" });
  const hash = await auth.hashPassword(auth.checkPasswordPolicy(body.password));
  await getDb().transaction([
    { text: "UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1", params: [s.user.id, hash] },
    // Déconnecte toutes les autres sessions.
    { text: "UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND token_hash <> $2 AND revoked_at IS NULL", params: [s.user.id, s.tokenHash] },
  ]);
  await auth.audit(s.user.id, "mot_de_passe.modifie", "user", s.user.id);
  send(res, 200, { ok: true, message: "Mot de passe modifié. Vos autres sessions ont été déconnectées." });
}

/* ── Méta ── */
async function meta(req, res) {
  const s = await auth.requireAuth(req);
  const db = getDb();
  const [categories, tags, authors] = await Promise.all([
    db.query("SELECT slug, label FROM categories ORDER BY position"),
    db.query("SELECT slug, label FROM tags ORDER BY label"),
    db.query("SELECT id, name FROM authors WHERE active ORDER BY name"),
  ]);
  const roles = auth.can(s, "user.manage") ? await db.query("SELECT code, label, description FROM roles ORDER BY id") : [];
  const last = (await db.query("SELECT value FROM site_settings WHERE key = 'scheduledLastRun'"))[0];
  send(res, 200, { ok: true, categories, tags, authors, roles, permissions: [...s.perms].sort(), siteRebuild: Boolean(process.env.VERCEL_DEPLOY_HOOK_URL), scheduledLastRun: last ? last.value : null });
}

/* ── Articles ── */
async function articlesRoute(req, res, parts) {
  const [, id, sub] = parts;
  if (id && !ARTICLE_ID_RE.test(id)) throw new HttpError(404, "Article introuvable.");
  const s = await auth.requireAuth(req);
  const m = req.method;
  if (!id && m === "GET") return send(res, 200, { ok: true, items: await articles.list(s, getQuery(req)) });
  if (!id && m === "POST") {
    if (!auth.can(s, "article.create")) throw new HttpError(403, "Vous n'avez pas les droits pour créer un article.");
    return send(res, 201, { ok: true, article: await articles.create(s, await readBody(req)) });
  }
  if (id && !sub && m === "GET") return send(res, 200, { ok: true, article: await articles.get(s, id) });
  if (id && !sub && m === "PUT") return send(res, 200, { ok: true, article: await articles.update(s, id, await readBody(req)) });
  if (id && !sub && m === "DELETE") return send(res, 200, await articles.remove(s, id));
  if (id && sub === "status" && m === "POST") return send(res, 200, { ok: true, article: await articles.setStatus(s, id, await readBody(req)) });
  if (id && sub === "sponsored" && m === "POST") return send(res, 200, { ok: true, article: await articles.setSponsored(s, id, await readBody(req)) });
  if (id && sub === "corrections" && m === "POST") return send(res, 201, { ok: true, article: await articles.addCorrection(s, id, await readBody(req)) });
  throw new HttpError(404, "Route inconnue.");
}

/* ── Messages de contact ── */
async function contactRoute(req, res, parts) {
  const id = parts[1];
  const db = getDb();
  if (!id && req.method === "GET") {
    await auth.requireAuth(req, "contact.read");
    const q = getQuery(req);
    const params = [];
    let where = "";
    if (q.status) { params.push(v.oneOf(q, "status", ["nouveau", "lu", "traite", "spam"])); where = "WHERE status = $1::contact_status"; }
    const items = await db.query(
      `SELECT id, name, email, category, subject, message, status, created_at, handled_at FROM contact_messages ${where}
       ORDER BY created_at DESC LIMIT 200`, params);
    return send(res, 200, { ok: true, items });
  }
  if (id && req.method === "PATCH") {
    if (!UUID_RE.test(id)) throw new HttpError(404, "Message introuvable.");
    const s = await auth.requireAuth(req, "contact.manage");
    const body = await readBody(req);
    const status = v.oneOf(body, "status", ["nouveau", "lu", "traite", "spam"], { label: "Statut" });
    const r = await db.query(
      "UPDATE contact_messages SET status = $2::contact_status, handled_by = $3, handled_at = now() WHERE id = $1 RETURNING id",
      [id, status, s.user.id]);
    if (!r.length) throw new HttpError(404, "Message introuvable.");
    await auth.audit(s.user.id, "contact.statut", "contact_message", id, { status });
    return send(res, 200, { ok: true });
  }
  throw new HttpError(404, "Route inconnue.");
}

/* ── Abonnés ── */
async function subscribersRoute(req, res, parts) {
  if (req.method !== "GET") throw new HttpError(405, "Méthode non autorisée.");
  const db = getDb();
  if (parts[1] === "stats") {
    await auth.requireAuth(req, "stats.read");
    const rows = await db.query("SELECT status::text, count(*)::int AS n FROM subscribers GROUP BY status");
    return send(res, 200, { ok: true, counts: Object.fromEntries(rows.map((r) => [r.status, r.n])) });
  }
  if (parts[1] === "export") {
    const s = await auth.requireAuth(req, "subscriber.export");
    const rows = await db.query("SELECT email, lang, confirmed_at, consent_at FROM subscribers WHERE status = 'confirme' ORDER BY confirmed_at");
    await auth.audit(s.user.id, "abonnes.export", "subscriber", null, { lignes: rows.length });
    const cell = (x) => `"${String(x == null ? "" : x instanceof Date ? x.toISOString() : x).replace(/"/g, '""').replace(/^[=+\-@]/, "'$&")}"`;
    const csv = "email,langue,confirme_le,consentement_le\n" + rows.map((r) => [r.email, r.lang, r.confirmed_at, r.consent_at].map(cell).join(",")).join("\n");
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="abonnes-hnetmedia.csv"');
    res.setHeader("Cache-Control", "no-store");
    return res.end(csv);
  }
  if (!parts[1]) {
    await auth.requireAuth(req, "subscriber.read");
    const items = await db.query(
      "SELECT id, email, lang, status, created_at, confirmed_at, unsubscribed_at FROM subscribers ORDER BY created_at DESC LIMIT 500");
    return send(res, 200, { ok: true, items });
  }
  throw new HttpError(404, "Route inconnue.");
}

/* ── Statistiques (internes, jamais publiées) ── */
async function statsRoute(req, res, parts) {
  if (parts[1] !== "views" || req.method !== "GET") throw new HttpError(404, "Route inconnue.");
  await auth.requireAuth(req, "stats.read");
  const days = Math.min(Math.max(parseInt(getQuery(req).days, 10) || 30, 1), 365);
  const db = getDb();
  const [perDay, topArticles] = await Promise.all([
    db.query(`SELECT date_trunc('day', bucket)::date AS day, SUM(views)::int AS views FROM page_views
              WHERE bucket >= now() - make_interval(days => $1) GROUP BY 1 ORDER BY 1`, [days]),
    db.query(`SELECT a.slug, t.title, SUM(pv.views)::int AS views FROM page_views pv
              JOIN articles a ON a.id = pv.article_id
              LEFT JOIN article_translations t ON t.article_id = a.id AND t.lang = a.original_lang
              WHERE pv.bucket >= now() - make_interval(days => $1)
              GROUP BY a.slug, t.title ORDER BY views DESC LIMIT 20`, [days]),
  ]);
  send(res, 200, { ok: true, days, perDay, topArticles });
}

/* ── Médiathèque (images téléversées) ── */
async function mediaRoute(req, res, parts) {
  if (parts[1]) throw new HttpError(404, "Route inconnue.");
  const s = await auth.requireAuth(req, "media.upload");
  if (req.method === "GET") return send(res, 200, { ok: true, items: await media.list(s) });
  if (req.method === "POST") return send(res, 201, { ok: true, media: await media.upload(s, req) });
  throw new HttpError(405, "Méthode non autorisée.");
}

/* ── Comptes ── */
async function usersRoute(req, res, parts) {
  const s = await auth.requireAuth(req, "user.manage");
  const db = getDb();
  const id = parts[1];
  if (!id && req.method === "GET") {
    const items = await db.query(
      `SELECT u.id, u.email, u.display_name AS name, r.code AS role, u.active, u.last_login_at, u.locked_until, u.created_at
       FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.created_at`);
    return send(res, 200, { ok: true, items });
  }
  if (!id && req.method === "POST") {
    const body = await readBody(req);
    const email = v.email(body, "email");
    const name = v.str(body, "name", { min: 2, max: 100, label: "Nom" });
    const role = v.str(body, "role", { max: 40, label: "Rôle" });
    const hash = await auth.hashPassword(auth.checkPasswordPolicy(body.password));
    try {
      const rows = await db.query(
        `INSERT INTO users (email, display_name, password_hash, role_id, password_changed_at)
         SELECT $1, $2, $3, r.id, now() FROM roles r WHERE r.code = $4 RETURNING id`, [email, name, hash, role]);
      if (!rows.length) throw new HttpError(400, "Rôle inconnu.", { field: "role" });
      await auth.audit(s.user.id, "compte.creation", "user", rows[0].id, { email, role });
      return send(res, 201, { ok: true, id: rows[0].id });
    } catch (e) {
      if (e.code === "23505") throw new HttpError(409, "Un compte existe déjà avec cette adresse.", { field: "email" });
      throw e;
    }
  }
  if (id && req.method === "PATCH") {
    if (!UUID_RE.test(id)) throw new HttpError(404, "Compte introuvable.");
    const body = await readBody(req);
    const target = (await db.query("SELECT u.id, r.code AS role, u.active FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1", [id]))[0];
    if (!target) throw new HttpError(404, "Compte introuvable.");
    const role = body.role !== undefined ? v.str(body, "role", { max: 40, label: "Rôle" }) : target.role;
    const active = body.active !== undefined ? Boolean(body.active) : target.active;
    if (!(await db.query("SELECT 1 FROM roles WHERE code = $1", [role])).length) throw new HttpError(400, "Rôle inconnu.", { field: "role" });
    if (id === s.user.id && (role !== target.role || !active)) {
      throw new HttpError(400, "Vous ne pouvez pas modifier votre propre rôle ni désactiver votre propre compte.");
    }
    if (target.role === "administrateur" && (role !== "administrateur" || !active)) {
      const n = (await db.query("SELECT count(*)::int AS n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = 'administrateur' AND u.active"))[0].n;
      if (n <= 1) throw new HttpError(400, "Impossible : il doit rester au moins un administrateur actif.");
    }
    const qs = [{
      text: `UPDATE users SET role_id = (SELECT id FROM roles WHERE code = $2), active = $3,
               failed_logins = CASE WHEN $4 THEN 0 ELSE failed_logins END,
               locked_until = CASE WHEN $4 THEN NULL ELSE locked_until END
             WHERE id = $1 AND EXISTS (SELECT 1 FROM roles WHERE code = $2)`,
      params: [id, role, active, body.unlock === true],
    }];
    if (body.password) {
      qs.push({ text: "UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1",
        params: [id, await auth.hashPassword(auth.checkPasswordPolicy(body.password))] });
    }
    // Tout changement de rôle, désactivation ou nouveau mot de passe déconnecte le compte.
    if (role !== target.role || !active || body.password) {
      qs.push({ text: "UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", params: [id] });
    }
    await db.transaction(qs);
    await auth.audit(s.user.id, "compte.modification", "user", id, { role, active, motDePasse: Boolean(body.password), unlock: body.unlock === true });
    return send(res, 200, { ok: true });
  }
  throw new HttpError(404, "Route inconnue.");
}

const ROUTES = {
  articles: articlesRoute,
  "contact-messages": contactRoute,
  subscribers: subscribersRoute,
  stats: statsRoute,
  media: mediaRoute,
  users: usersRoute,
};

module.exports = handler(["GET", "POST", "PUT", "PATCH", "DELETE"], async (req, res) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  const parts = routeOf(req);
  const key = parts.join("/");
  if (key === "auth/setup" && req.method === "POST") return setup(req, res);
  if (key === "auth/login" && req.method === "POST") return login(req, res);
  if (key === "auth/logout" && req.method === "POST") return logout(req, res);
  if (key === "auth/session" && req.method === "GET") return session(req, res);
  if (key === "auth/password" && req.method === "POST") return changePassword(req, res);
  if (key === "meta" && req.method === "GET") return meta(req, res);
  const fn = ROUTES[parts[0]];
  if (!fn) throw new HttpError(404, "Route inconnue.");
  return fn(req, res, parts);
});
