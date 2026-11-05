"use strict";
/**
 * Mesure d'audience minimale et respectueuse :
 *   POST /api/views            { path:"/article/slug" }  → +1 vue (agrégée par heure)
 *   GET  /api/views?top=lus    → les plus lus (7 jours)
 *   GET  /api/views?top=tendances → hausse sur 24 h vs les 24 h précédentes
 * Aucune IP ni identifiant stocké avec les vues. Les robots, les signaux
 * « ne pas suivre » (DNT / GPC) et les rechargements rapprochés sont ignorés.
 */
const { handler, send, readBody, getQuery, HttpError } = require("../server/http");
const { getDb } = require("../server/db");
const { hit } = require("../server/ratelimit");
const { clientIp, fingerprint } = require("../server/security");

const BOT_RE = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora|pinterest|vkshare|whatsapp|telegram|preview|headless|lighthouse|curl|wget|python|httpclient|axios|node-fetch/i;
const PATH_RE = /^\/article\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\.html)?$/;

async function track(req, res) {
  const ua = String(req.headers["user-agent"] || "");
  const optOut = req.headers.dnt === "1" || req.headers["sec-gpc"] === "1";
  let body = {};
  try { body = await readBody(req); } catch { /* corps illisible : ignoré */ }
  const m = PATH_RE.exec(String(body.path || ""));
  if (!m || optOut || !ua || BOT_RE.test(ua)) return send(res, 204);

  const db = getDb();
  const ipKey = fingerprint(clientIp(req));
  // 1 vue par visiteur et par article toutes les 30 min ; 300 vues/heure max par IP.
  if ((await hit(`view:${ipKey}:${m[1]}`, 1800)) > 1) return send(res, 204);
  if ((await hit(`viewip:${ipKey}`, 3600)) > 300) return send(res, 204);

  await db.query(
    `INSERT INTO page_views (path, bucket, article_id, views)
     SELECT '/article/' || a.slug, date_trunc('hour', now()), a.id, 1
     FROM articles a WHERE a.slug = $1 AND a.status = 'publie' AND a.published_at <= now()
     ON CONFLICT (path, bucket) DO UPDATE SET views = page_views.views + 1`, [m[1]]);
  send(res, 204);
}

const PUBLIC_COLS = `a.slug, t.title, a.category_slug AS category, a.published_at`;
const PUBLIC_JOIN = `JOIN articles a ON a.id = pv.article_id AND a.status = 'publie' AND a.published_at <= now()
  JOIN article_translations t ON t.article_id = a.id AND t.lang = a.original_lang`;

async function top(req, res) {
  const q = getQuery(req);
  const n = Math.min(Math.max(parseInt(q.limit, 10) || 5, 1), 10);
  const db = getDb();
  let rows;
  if (q.top === "tendances") {
    rows = await db.query(
      `SELECT ${PUBLIC_COLS},
              SUM(pv.views) FILTER (WHERE pv.bucket >= now() - interval '24 hours') AS recent,
              SUM(pv.views) FILTER (WHERE pv.bucket <  now() - interval '24 hours') AS before
       FROM page_views pv ${PUBLIC_JOIN}
       WHERE pv.bucket >= now() - interval '48 hours'
       GROUP BY a.id, t.title
       HAVING SUM(pv.views) FILTER (WHERE pv.bucket >= now() - interval '24 hours') >= 5
       ORDER BY (COALESCE(SUM(pv.views) FILTER (WHERE pv.bucket >= now() - interval '24 hours'), 0)
                 - COALESCE(SUM(pv.views) FILTER (WHERE pv.bucket < now() - interval '24 hours'), 0)) DESC
       LIMIT $1`, [n]);
  } else if (!q.top || q.top === "lus") {
    rows = await db.query(
      `SELECT ${PUBLIC_COLS}
       FROM page_views pv ${PUBLIC_JOIN}
       WHERE pv.bucket >= now() - interval '7 days'
       GROUP BY a.id, t.title
       ORDER BY SUM(pv.views) DESC, a.published_at DESC
       LIMIT $1`, [n]);
  } else {
    throw new HttpError(400, "Paramètre « top » invalide.");
  }
  // Pas de chiffres d'audience exposés publiquement : seulement l'ordre.
  const items = rows.map((r) => ({ slug: r.slug, title: r.title, category: r.category, url: `/article/${r.slug}`, publishedAt: r.published_at }));
  send(res, 200, { ok: true, items }, { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600" });
}

module.exports = handler(["GET", "POST"], async (req, res) => (req.method === "POST" ? track(req, res) : top(req, res)));
