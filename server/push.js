"use strict";
/**
 * Notifications push (Firebase Cloud Messaging, API HTTP v1) vers l'application Android de l'équipe.
 * Aucune dépendance : le jeton d'accès Google est obtenu avec un JWT signé (crypto de Node).
 *
 * Variables (Vercel) :
 *   FCM_SERVICE_ACCOUNT_JSON  clé du compte de service Firebase (JSON brut ou encodé en base64) — SECRET
 *   FCM_PROJECT_ID            facultatif (sinon lu dans la clé)
 * Sans clé, rien n'est envoyé et rien ne casse (isConfigured() = false).
 *
 * Les messages sont des messages « données seules » (title, body, url, channel) : c'est l'application
 * qui affiche la notification, dans le bon canal (comments / messages / publication).
 * Un envoi raté n'annule JAMAIS l'action qui l'a déclenché.
 */
const crypto = require("crypto");
const { getDb } = require("./db");

let cached = null; // { token, exp }

function credentials() {
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const txt = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const j = JSON.parse(txt);
    if (!j.client_email || !j.private_key) return null;
    return { email: j.client_email, key: j.private_key, projectId: process.env.FCM_PROJECT_ID || j.project_id };
  } catch { return null; }
}

function isConfigured() {
  if (process.env.FCM_TEST_SINK) return true;
  const c = credentials();
  return Boolean(c && c.projectId);
}

const b64u = (b) => Buffer.from(b).toString("base64url");

async function accessToken(c) {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 60 > now) return cached.token;
  const head = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64u(JSON.stringify({
    iss: c.email, scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const sig = crypto.createSign("RSA-SHA256").update(`${head}.${claims}`).sign(c.key).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claims}.${sig}` }),
  });
  if (!res.ok) throw new Error(`oauth ${res.status}`);
  const j = await res.json();
  cached = { token: j.access_token, exp: now + (j.expires_in || 3600) };
  return cached.token;
}

const CHANNELS = ["comments", "messages", "publication"];
const cut = (s, n) => String(s || "").replace(/[\u0000-\u001F\u007F]/g, " ").slice(0, n);

/** Envoie à un jeton. Renvoie "ok", "gone" (jeton périmé : à supprimer) ou "error". */
async function sendOne(c, token, data) {
  if (process.env.FCM_TEST_SINK) {
    (global.__pushSent = global.__pushSent || []).push({ token, data });
    return "ok";
  }
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${c.projectId}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken(c)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { token, data, android: { priority: "HIGH" } } }),
  });
  if (res.ok) return "ok";
  if (res.status === 404) return "gone";
  const t = await res.text().catch(() => "");
  if (res.status === 400 && /UNREGISTERED|INVALID_ARGUMENT/.test(t)) return "gone";
  console.error("[push] FCM", res.status);
  return "error";
}

/**
 * Notifie les appareils des comptes actifs qui possèdent `permission` (null = tous), ou seulement les comptes
 * `userIds` si fourni ; `excludeUserId` écarte l'auteur de l'action (on ne le prévient pas de ce qu'il vient de faire).
 * Ne lève jamais d'exception. Renvoie le nombre d'envois réussis.
 */
async function notify({ permission = null, userIds = null, excludeUserId = null, channel, title, body, url = "/admin" }) {
  try {
    if (!isConfigured()) return 0;
    const c = process.env.FCM_TEST_SINK ? { projectId: "test" } : credentials();
    const db = getDb();
    const rows = await db.query(
      `SELECT d.token FROM device_tokens d JOIN users u ON u.id = d.user_id AND u.active
       WHERE ($2::uuid[] IS NULL OR u.id = ANY($2::uuid[]))
         AND ($3::uuid IS NULL OR u.id <> $3::uuid)
         AND ($1::text IS NULL OR EXISTS (
           SELECT 1 FROM role_permissions rp WHERE rp.role_id = u.role_id AND rp.permission_code = $1::text))`,
      [permission, userIds && userIds.length ? userIds : (userIds ? [] : null), excludeUserId]);
    if (!rows.length) return 0;
    const data = {
      title: cut(title, 80), body: cut(body, 200),
      url: String(url).startsWith("/") ? String(url).slice(0, 300) : "/admin",
      channel: CHANNELS.includes(channel) ? channel : "messages",
    };
    const results = await Promise.all(rows.map((r) => sendOne(c, r.token, data).catch(() => "error")));
    const gone = rows.filter((_, i) => results[i] === "gone").map((r) => r.token);
    if (gone.length) await db.query("DELETE FROM device_tokens WHERE token = ANY($1::text[])", [gone]);
    return results.filter((r) => r === "ok").length;
  } catch (e) {
    console.error("[push] échec :", e && e.message);
    return 0;
  }
}

/**
 * Nouveau commentaire à modérer (appelée par server/comments.js à chaque dépôt) : modérateurs (comment.moderate).
 */
function notifyNewComment({ articleTitle, author, slug }) {
  return notify({
    permission: "comment.moderate", channel: "comments", title: "Commentaire à modérer",
    body: `${author || "Un lecteur"} sur « ${articleTitle || slug || "un article"} »`, url: "/admin#/commentaires",
  });
}

module.exports = { notify, notifyNewComment, isConfigured };
