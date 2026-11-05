"use strict";
/**
 * Envoi d'e-mails transactionnels.
 * Fournisseur : Brevo (API HTTP v3), activé UNIQUEMENT si BREVO_API_KEY et
 * EMAIL_FROM sont définies. Sinon isConfigured() = false et les fonctions qui
 * en dépendent répondent honnêtement « service non activé » (jamais de faux envoi).
 */
const { HttpError } = require("./http");

function isConfigured() {
  return Boolean(process.env.BREVO_API_KEY && process.env.EMAIL_FROM);
}

async function send({ to, subject, html, text, headers }) {
  if (!isConfigured()) throw new HttpError(503, "L'envoi d'e-mails n'est pas encore activé.");
  if (process.env.EMAIL_TEST_SINK) {
    // Tests automatisés : on enregistre l'e-mail au lieu de l'envoyer.
    (global.__sentEmails = global.__sentEmails || []).push({ to, subject, html, text, headers });
    return { messageId: "test" };
  }
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": process.env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: process.env.EMAIL_FROM, name: process.env.EMAIL_FROM_NAME || "HNet Media" },
      to: [{ email: to }],
      subject, htmlContent: html, textContent: text,
      headers: headers || undefined,
    }),
  });
  if (!r.ok) {
    console.error("[email] échec d'envoi, statut", r.status); // jamais la clé ni le contenu
    throw new HttpError(502, "L'e-mail n'a pas pu être envoyé. Réessayez dans quelques minutes.");
  }
  return r.json().catch(() => ({}));
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

module.exports = { isConfigured, send, esc };
