"use strict";
/**
 * Déclenche un nouveau build Vercel (Deploy Hook) après une publication,
 * pour régénérer le site statique. URL secrète : VERCEL_DEPLOY_HOOK_URL.
 * Retourne true/false ; n'échoue jamais la requête d'origine.
 */
async function triggerRebuild(reason) {
  const url = process.env.VERCEL_DEPLOY_HOOK_URL;
  if (!url) return false;
  try {
    const r = await fetch(url, { method: "POST" });
    if (!r.ok) console.error("[rebuild] statut", r.status, "—", reason);
    return r.ok;
  } catch (e) {
    console.error("[rebuild] échec —", reason);
    return false;
  }
}
module.exports = { triggerRebuild };
