"use strict";
/**
 * GET /api/health — contrôle de santé public et minimal.
 * Public : seulement « ok » et « database » (la base répond-elle ?). Le détail de configuration (oui/non, jamais les
 * valeurs) n'est donné qu'avec « Authorization: Bearer <CRON_SECRET> ». Aucun nom d'hôte, aucun détail d'erreur.
 */
const { handler, send } = require("../server/http");
const { getDb } = require("../server/db");
const push = require("../server/push");
const { safeEqual } = require("../server/security");

/** Le détail de configuration (secrets présents, mise à jour auto, push, adresse) n'est donné qu'avec le secret du cron. */
const hasDetailAccess = (req) => {
  const secret = process.env.CRON_SECRET;
  const given = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return Boolean(secret && secret.length >= 24 && given && safeEqual(given, secret));
};

module.exports = handler(["GET"], async (req, res) => {
  const hashOk = Boolean(process.env.HASH_SECRET && process.env.HASH_SECRET.length >= 32);
  const out = { ok: true, database: false };
  try {
    await getDb().query("SELECT 1");
    out.database = true;
  } catch (e) {
    console.error("[health] base injoignable :", e && e.code);
  }
  out.ok = out.database && hashOk;
  if (hasDetailAccess(req)) {
    // Simples oui/non (jamais les valeurs).
    out.hashSecret = hashOk;
    out.deployHook = Boolean(process.env.VERCEL_DEPLOY_HOOK_URL);
    out.push = push.isConfigured();
    try { out.siteUrl = new URL(process.env.SITE_URL).origin; } catch (e) { out.siteUrl = null; }
  }
  send(res, out.ok ? 200 : 503, out, { "X-Robots-Tag": "noindex" });
});
