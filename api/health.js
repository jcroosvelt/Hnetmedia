"use strict";
/**
 * GET /api/health — contrôle de santé public et minimal.
 * Indique seulement si la base répond, si le secret de hachage est présent et si le Deploy Hook
 * (mise à jour auto du site) est configuré — de simples oui/non.
 * Aucune valeur, aucun nom d'hôte, aucun détail d'erreur n'est exposé.
 */
const { handler, send } = require("../server/http");
const { getDb } = require("../server/db");
const push = require("../server/push");

module.exports = handler(["GET"], async (req, res) => {
  const out = { ok: true, database: false, hashSecret: Boolean(process.env.HASH_SECRET && process.env.HASH_SECRET.length >= 32) };
  try {
    await getDb().query("SELECT 1");
    out.database = true;
  } catch (e) {
    console.error("[health] base injoignable :", e && e.code);
  }
  out.ok = out.database && out.hashSecret;
  // Simple oui/non (jamais la valeur) : la mise à jour automatique du site après publication est-elle configurée ?
  out.deployHook = Boolean(process.env.VERCEL_DEPLOY_HOOK_URL);
  // Simple oui/non : la clé Firebase (notifications push) est-elle présente ET lisible ? (jamais la valeur)
  out.push = push.isConfigured();
  // Adresse publique du site (déjà visible de tous) : permet de vérifier la configuration de SITE_URL.
  try { out.siteUrl = new URL(process.env.SITE_URL).origin; } catch (e) { out.siteUrl = null; }
  send(res, out.ok ? 200 : 503, out, { "X-Robots-Tag": "noindex" });
});
