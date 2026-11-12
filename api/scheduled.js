"use strict";
/**
 * GET|POST /api/scheduled — publie les articles programmés dont l'heure est arrivée.
 * Protégé par un secret : l'en-tête « Authorization: Bearer <CRON_SECRET> » (c'est exactement ce que
 * Vercel Cron envoie quand la variable CRON_SECRET existe ; un service de planification externe
 * peut faire de même, toutes les 5 minutes, pour une publication à l'heure près).
 * Sans CRON_SECRET (24 caractères minimum), le point d'entrée est fermé.
 */
const { handler, send, HttpError } = require("../server/http");
const { limit } = require("../server/ratelimit");
const { clientIp, fingerprint, safeEqual } = require("../server/security");
const scheduled = require("../server/scheduled");

module.exports = handler(["GET", "POST"], async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 24) throw new HttpError(503, "Publication programmée non configurée (CRON_SECRET absente ou trop courte).");
  await limit(`cron:${fingerprint(clientIp(req))}`, 60, 3600, "Trop de tentatives.");
  const given = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!given || !safeEqual(given, secret)) throw new HttpError(401, "Non autorisé.");
  const r = await scheduled.run();
  send(res, 200, { ok: true, promoted: r.promoted.length, slugs: r.promoted, blocked: r.blocked, rebuild: r.rebuild, reminded: r.reminded });
});
