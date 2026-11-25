"use strict";
/**
 * Journal de sécurité : une ligne JSON par événement, dans les journaux de la plateforme (Vercel › Logs).
 * Jamais de mot de passe, de jeton, d'e-mail ni d'adresse IP en clair : seulement une empreinte HMAC de l'IP
 * (même visiteur = même empreinte, mais non réversible sans le secret du serveur).
 */
const { clientIp, fingerprint } = require("./security");

function secLog(event, req, details = {}) {
  const line = { t: new Date().toISOString(), evt: event };
  try {
    if (req) {
      line.ip = fingerprint(clientIp(req));
      line.m = req.method;
      line.path = String(req.url || "").split("?")[0].slice(0, 80);
    }
  } catch { /* secret absent : on journalise quand même l'événement */ }
  for (const [k, v] of Object.entries(details)) line[k] = typeof v === "string" ? v.slice(0, 80) : v;
  console.warn("[sécu] " + JSON.stringify(line));
}

module.exports = { secLog };
