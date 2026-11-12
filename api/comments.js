"use strict";
/**
 * Commentaires des lecteurs (public) :
 *   GET  /api/comments?article=<slug>   commentaires approuvés (avec réponses)
 *   POST /api/comments                  { article, name, email?, body, parentId?, lang?, hp, ts }
 * Le dépôt est toujours « en attente de modération » : la réponse le dit honnêtement.
 */
const { handler, send, readBody, getQuery, HttpError } = require("../server/http");
const antispam = require("../server/antispam");
const { limit } = require("../server/ratelimit");
const { clientIp, fingerprint, checkOrigin } = require("../server/security");
const comments = require("../server/comments");

module.exports = handler(["GET", "POST"], async (req, res) => {
  if (req.method === "GET") {
    const slug = String(getQuery(req).article || "");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 160) throw new HttpError(400, "Article invalide.");
    const r = await comments.listPublic(slug);
    res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
    return send(res, 200, { ok: true, enabled: await comments.enabled(), ...r });
  }
  checkOrigin(req);
  const body = await readBody(req);
  antispam.check(body, { minMs: 4000 });
  const ipKey = fingerprint(clientIp(req));
  await limit(`cmt:ip:${ipKey}`, 5, 3600, "Vous avez envoyé plusieurs commentaires récemment. Réessayez dans une heure.");
  await limit(`cmt:min:${ipKey}`, 2, 60, "Patientez une minute avant d'envoyer un autre commentaire.");
  await comments.submit(body, { ipKey, userAgent: req.headers["user-agent"] });
  send(res, 201, { ok: true, pending: true, message: "Merci ! Votre commentaire a bien été reçu. Il sera publié après relecture par la rédaction." });
});
