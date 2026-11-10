"use strict";
/**
 * Newsletter (double confirmation) :
 *   POST /api/newsletter/subscribe    { email, consent:true, lang?, hp, ts }
 *   POST /api/newsletter/confirm      { token }
 *   POST /api/newsletter/unsubscribe  { token }  (ou ?token=… + List-Unsubscribe=One-Click)
 * Les liens des e-mails mènent à des pages qui demandent un clic de
 * confirmation : un antivirus qui « visite » le lien ne valide rien tout seul.
 */
const { handler, send, readBody, getQuery, HttpError } = require("../server/http");
const { getDb } = require("../server/db");
const v = require("../server/validate");
const antispam = require("../server/antispam");
const { limit } = require("../server/ratelimit");
const { clientIp, fingerprint, checkOrigin, randomToken, sha256 } = require("../server/security");
const email = require("../server/email");
const { siteUrl, NEWSLETTER_CONSENT } = require("../server/site");

const CONFIRM_HOURS = 48;
const GENERIC_OK = "Merci ! Si cette adresse n'est pas déjà inscrite, un e-mail de confirmation vient de vous être envoyé. Cliquez sur le lien qu'il contient pour finaliser l'inscription.";

async function subscribe(req, res) {
  checkOrigin(req);
  const body = await readBody(req);
  antispam.check(body, { minMs: 1500 });
  // Écrire à des lecteurs exige un domaine d'envoi vérifié : sinon on refuse honnêtement.
  if (!email.canSendToPublic()) throw new HttpError(503, "L'inscription à la newsletter n'est pas encore activée.");

  const addr = v.email(body, "email");
  if (body.consent !== true && body.consent !== "true" && body.consent !== "on") {
    throw new HttpError(400, "Vous devez accepter de recevoir la newsletter pour vous inscrire.", { field: "consent" });
  }
  const lang = ["fr", "en"].includes(body.lang) ? body.lang : "fr";

  const ipKey = fingerprint(clientIp(req));
  await limit(`nl:ip:${ipKey}`, 10, 3600, "Trop de demandes d'inscription. Réessayez dans une heure.");
  await limit(`nl:email:${fingerprint(addr)}`, 3, 86400, "Trop de demandes pour cette adresse aujourd'hui. Vérifiez votre boîte mail ou réessayez demain.");

  const token = randomToken(32);
  const rows = await getDb().query(
    `INSERT INTO subscribers (email, lang, status, consent_text, consent_at, consent_ip_hash, confirm_token_hash, confirm_expires_at, source)
     VALUES ($1, $2, 'en_attente', $3, now(), $4, $5, now() + make_interval(hours => $6), 'site')
     ON CONFLICT (email) DO UPDATE SET
       lang = EXCLUDED.lang, status = 'en_attente', consent_text = EXCLUDED.consent_text, consent_at = now(),
       consent_ip_hash = EXCLUDED.consent_ip_hash, confirm_token_hash = EXCLUDED.confirm_token_hash,
       confirm_expires_at = EXCLUDED.confirm_expires_at, unsubscribed_at = NULL
     WHERE subscribers.status <> 'confirme'
     RETURNING id`,
    [addr, lang, NEWSLETTER_CONSENT, ipKey, sha256(token), CONFIRM_HOURS]
  );

  // Adresse déjà confirmée : aucune modification, aucun e-mail, même réponse (pas de divulgation).
  if (rows.length) {
    const link = `${siteUrl(req)}/newsletter-confirmation?token=${encodeURIComponent(token)}`;
    await email.send({
      to: addr,
      subject: "Confirmez votre inscription à la newsletter HNet Media",
      text: `Bonjour,\n\nPour confirmer votre inscription à la newsletter HNet Media, ouvrez ce lien (valable ${CONFIRM_HOURS} heures) :\n${link}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez simplement cet e-mail : vous ne serez pas inscrit.\n\nHNet Media`,
      html: `<p>Bonjour,</p><p>Pour confirmer votre inscription à la newsletter HNet Media, cliquez sur le lien ci-dessous (valable ${CONFIRM_HOURS}&nbsp;heures) :</p><p><a href="${email.esc(link)}">Confirmer mon inscription</a></p><p>Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet e-mail : vous ne serez pas inscrit.</p><p>HNet Media</p>`,
    });
  }
  send(res, 200, { ok: true, message: GENERIC_OK });
}

async function confirm(req, res) {
  checkOrigin(req);
  const body = await readBody(req);
  const token = v.str(body, "token", { max: 100, label: "Jeton" });
  await limit(`nlc:${fingerprint(clientIp(req))}`, 30, 3600);
  const rows = await getDb().query(
    `UPDATE subscribers SET status = 'confirme', confirmed_at = now(), confirm_token_hash = NULL, confirm_expires_at = NULL
     WHERE confirm_token_hash = $1 AND confirm_expires_at > now() AND status = 'en_attente'
     RETURNING id`, [sha256(token)]);
  if (!rows.length) throw new HttpError(400, "Ce lien de confirmation est invalide ou a expiré. Inscrivez-vous à nouveau pour recevoir un nouveau lien.");
  send(res, 200, { ok: true, message: "Votre inscription est confirmée. Merci de suivre HNet Media !" });
}

async function unsubscribe(req, res) {
  // Origin facultative : la désinscription « en un clic » vient du client mail.
  checkOrigin(req, { required: false });
  const body = await readBody(req);
  const token = v.clean(body.token || getQuery(req).token);
  if (!token || token.length > 100) throw new HttpError(400, "Lien de désinscription invalide.");
  await limit(`nlu:${fingerprint(clientIp(req))}`, 30, 3600);
  const rows = await getDb().query(
    `UPDATE subscribers SET status = 'desinscrit', unsubscribed_at = COALESCE(unsubscribed_at, now()),
       confirm_token_hash = NULL, confirm_expires_at = NULL
     WHERE unsubscribe_token = $1 RETURNING id`, [token]);
  if (!rows.length) throw new HttpError(400, "Lien de désinscription invalide.");
  send(res, 200, { ok: true, message: "Vous êtes désinscrit de la newsletter. Vous ne recevrez plus d'envois." });
}

const ACTIONS = { subscribe, confirm, unsubscribe };

module.exports = handler(["POST"], async (req, res) => {
  const q = getQuery(req);
  const action = q.action || String(new URL(req.url, "http://x").pathname.split("/").pop());
  const fn = ACTIONS[action];
  if (!fn) throw new HttpError(404, "Action inconnue.");
  await fn(req, res);
});
