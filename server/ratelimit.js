"use strict";
/**
 * Limitation de débit par fenêtre fixe, stockée dans Neon (table rate_limits).
 * Clé = action + empreinte (jamais l'IP en clair).
 */
const { getDb } = require("./db");
const { HttpError } = require("./http");

async function hit(key, windowSeconds) {
  const db = getDb();
  const rows = await db.query(
    `INSERT INTO rate_limits (key, window_start, hits)
     VALUES ($1, to_timestamp(floor(extract(epoch FROM now()) / $2) * $2), 1)
     ON CONFLICT (key, window_start) DO UPDATE SET hits = rate_limits.hits + 1
     RETURNING hits`,
    [key, windowSeconds]
  );
  // Ménage occasionnel des compteurs expirés (plus de 2 jours).
  if (Math.random() < 0.01) {
    db.query("DELETE FROM rate_limits WHERE window_start < now() - interval '2 days'").catch(() => {});
  }
  return rows[0].hits;
}

/** Lève une erreur 429 si la limite est dépassée. */
async function limit(key, max, windowSeconds, message = "Trop de tentatives. Réessayez plus tard.") {
  const n = await hit(key, windowSeconds);
  if (n > max) throw new HttpError(429, message);
  return n;
}

module.exports = { hit, limit };
