"use strict";
/**
 * POST /api/contact — enregistre un message de contact dans Neon.
 * Le message est réellement conservé (consultable dans l'admin) ; si l'envoi
 * d'e-mails est configuré, la rédaction reçoit aussi une notification.
 */
const { handler, send, readBody } = require("../server/http");
const { getDb } = require("../server/db");
const v = require("../server/validate");
const antispam = require("../server/antispam");
const { limit } = require("../server/ratelimit");
const { clientIp, fingerprint, checkOrigin } = require("../server/security");
const email = require("../server/email");
const { DEFAULT_CONTACT_CATEGORIES } = require("../server/site");
const push = require("../server/push");

module.exports = handler(["POST"], async (req, res) => {
  checkOrigin(req);
  const body = await readBody(req);
  antispam.check(body, { minMs: 3000 });

  const db = getDb();
  const ipKey = fingerprint(clientIp(req));
  const setting = await db.query("SELECT value FROM site_settings WHERE key = 'contactCategories'");
  const categories = Array.isArray(setting[0] && setting[0].value) ? setting[0].value : DEFAULT_CONTACT_CATEGORIES;

  const msg = {
    name: v.str(body, "name", { min: 2, max: 100, label: "Nom" }),
    email: v.email(body, "email"),
    category: v.oneOf(body, "category", categories, { label: "Objet" }),
    subject: v.str(body, "subject", { max: 200, required: false, label: "Sujet" }),
    message: v.str(body, "message", { min: 10, max: 5000, multiline: true, label: "Message" }),
  };

  await limit(`contact:${ipKey}`, 5, 3600, "Vous avez envoyé plusieurs messages récemment. Réessayez dans une heure.");
  await db.query(
    `INSERT INTO contact_messages (name, email, category, subject, message, ip_hash, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [msg.name, msg.email, msg.category, msg.subject, msg.message, ipKey, String(req.headers["user-agent"] || "").slice(0, 300)]
  );

  // Notification à la rédaction (facultative, n'annule jamais l'enregistrement).
  const notify = process.env.CONTACT_NOTIFY_EMAIL;
  if (notify && email.isConfigured()) {
    const e = email.esc;
    await email.send({
      to: notify,
      subject: `[Contact – ${msg.category}] ${msg.subject || "Nouveau message"}`,
      text: `De : ${msg.name} <${msg.email}>\nObjet : ${msg.category}\n\n${msg.message}`,
      html: `<p><strong>De :</strong> ${e(msg.name)} &lt;${e(msg.email)}&gt;<br><strong>Objet :</strong> ${e(msg.category)}</p><p>${e(msg.message).replace(/\n/g, "<br>")}</p>`,
      replyTo: msg.email,
    }).catch((err) => console.error("[contact] notification non envoyée :", err.status || ""));
  }

  // Notification push à l'équipe (facultative, n'annule jamais l'enregistrement ; sans le contenu du message).
  await push.notify({
    permission: "contact.read", channel: "messages", title: "Nouveau message de contact",
    body: `${msg.name} — ${msg.subject || msg.category}`, url: "/admin#/messages",
  });

  send(res, 200, { ok: true, message: "Votre message a bien été reçu. La rédaction vous répondra par e-mail." });
});
