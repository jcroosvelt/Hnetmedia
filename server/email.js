"use strict";
/**
 * Envoi d'e-mails transactionnels — fournisseur : Resend (API HTTP).
 * Actif UNIQUEMENT si RESEND_API_KEY et EMAIL_FROM sont définies ; sinon les fonctions qui
 * en dépendent répondent honnêtement « service non activé » (jamais de faux envoi).
 *
 * Deux niveaux, car Resend limite les envois tant qu'aucun domaine n'est vérifié :
 *  - isConfigured()    : on peut envoyer des e-mails à l'ÉQUIPE (ex. alerte « nouveau message »).
 *                        Sans domaine, Resend n'autorise que l'expéditeur de test
 *                        « onboarding@resend.dev » et seulement vers l'adresse du compte Resend.
 *  - canSendToPublic() : on peut écrire à des LECTEURS (confirmation de newsletter).
 *                        Exige un domaine vérifié chez Resend : EMAIL_FROM ne doit plus être
 *                        en @resend.dev.
 */
const { HttpError } = require("./http");

function isConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}
function canSendToPublic() {
  return isConfigured() && !/@resend\.dev\s*>?\s*$/i.test(process.env.EMAIL_FROM.trim());
}

function fromHeader() {
  const addr = process.env.EMAIL_FROM.trim();
  const name = (process.env.EMAIL_FROM_NAME || "HNet Media").replace(/[<>"\r\n]/g, "").trim();
  return addr.includes("<") || !name ? addr : `${name} <${addr}>`;
}

async function send({ to, subject, html, text, replyTo }) {
  if (!isConfigured()) throw new HttpError(503, "L'envoi d'e-mails n'est pas encore activé.");
  if (process.env.EMAIL_TEST_SINK) {
    // Tests automatisés : on enregistre l'e-mail au lieu de l'envoyer.
    (global.__sentEmails = global.__sentEmails || []).push({ to, subject, html, text, replyTo, from: fromHeader() });
    return { id: "test" };
  }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: fromHeader(), to: [to], subject, html, text, reply_to: replyTo || undefined }),
  });
  if (!r.ok) {
    // Jamais la clé, l'adresse du destinataire ni le contenu dans les journaux : statut et type d'erreur seulement.
    const info = await r.json().catch(() => ({}));
    console.error("[email] échec d'envoi : statut", r.status, info && info.name ? "· " + info.name : "");
    throw new HttpError(502, "L'e-mail n'a pas pu être envoyé. Réessayez dans quelques minutes.");
  }
  return r.json().catch(() => ({}));
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

module.exports = { isConfigured, canSendToPublic, send, esc };
