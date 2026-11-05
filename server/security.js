"use strict";
const crypto = require("crypto");
const { HttpError } = require("./http");
const { ConfigError } = require("./db");

function hashSecret() {
  const s = process.env.HASH_SECRET;
  if (!s || s.length < 32) throw new ConfigError("HASH_SECRET absente ou trop courte (32 caractères minimum)");
  return s;
}

/** IP du client (derrière le proxy Vercel). Jamais stockée en clair. */
function clientIp(req) {
  const xff = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xff || String(req.headers["x-real-ip"] || "") || (req.socket && req.socket.remoteAddress) || "inconnue";
}

/** Empreinte HMAC d'une IP (ou d'un e-mail) : non réversible sans le secret serveur. */
function fingerprint(value) {
  return crypto.createHmac("sha256", hashSecret()).update(String(value).toLowerCase()).digest("hex").slice(0, 32);
}

const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
const sha256 = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * Protection CSRF de base : l'en-tête Origin (envoyé par tous les navigateurs
 * sur un POST) doit correspondre à l'hôte servi. `required=false` tolère
 * l'absence d'Origin (ex. désinscription en un clic depuis un client mail).
 */
function checkOrigin(req, { required = true } = {}) {
  const origin = req.headers.origin;
  if (!origin) {
    if (required) throw new HttpError(403, "Origine de la requête manquante.");
    return;
  }
  let host;
  try { host = new URL(origin).host; } catch { throw new HttpError(403, "Origine invalide."); }
  const served = String(req.headers["x-forwarded-host"] || req.headers.host || "");
  const allowed = new Set([served]);
  if (process.env.SITE_URL) { try { allowed.add(new URL(process.env.SITE_URL).host); } catch { /* ignoré */ } }
  if (!allowed.has(host)) throw new HttpError(403, "Origine non autorisée.");
}

module.exports = { clientIp, fingerprint, randomToken, sha256, safeEqual, checkOrigin };
