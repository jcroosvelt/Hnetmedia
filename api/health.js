"use strict";
/**
 * GET /api/health — contrôle de santé public et minimal.
 * Indique seulement si la base répond et si le secret de hachage est présent.
 * Aucune valeur, aucun nom d'hôte, aucun détail d'erreur n'est exposé.
 */
const { handler, send } = require("../server/http");
const { getDb } = require("../server/db");

module.exports = handler(["GET"], async (req, res) => {
  const out = { ok: true, database: false, hashSecret: Boolean(process.env.HASH_SECRET && process.env.HASH_SECRET.length >= 32) };
  try {
    await getDb().query("SELECT 1");
    out.database = true;
  } catch (e) {
    console.error("[health] base injoignable :", e && e.code);
  }
  out.ok = out.database && out.hashSecret;
  send(res, out.ok ? 200 : 503, out, { "X-Robots-Tag": "noindex" });
});
