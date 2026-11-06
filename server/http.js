"use strict";
/** Utilitaires HTTP sans dépendance (compatibles Vercel et http.createServer). */
const { ConfigError } = require("./db");

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

const MAX_BODY = 64 * 1024;

function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(body === undefined ? "" : JSON.stringify(body));
}

function getQuery(req) {
  const u = new URL(req.url, "http://x");
  return Object.fromEntries(u.searchParams.entries());
}

async function readBody(req) {
  // Vercel fournit parfois déjà req.body (objet, chaîne ou Buffer).
  let raw;
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
    raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body);
  } else {
    raw = await new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on("data", (c) => {
        size += c.length;
        if (size > MAX_BODY) { reject(new HttpError(413, "Requête trop volumineuse.")); req.destroy(); return; }
        chunks.push(c);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }
  if (raw.length > MAX_BODY) throw new HttpError(413, "Requête trop volumineuse.");
  if (!raw) return {};
  const type = String(req.headers["content-type"] || "");
  if (type.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(raw));
  try { return JSON.parse(raw); } catch { throw new HttpError(400, "Corps de requête invalide."); }
}

/** Corps binaire (image) : octets bruts, taille plafonnée. Fonctionne avec ou sans corps déjà lu par Vercel. */
async function readRaw(req, maxBytes) {
  if (req.body !== undefined && req.body !== null && typeof req.body !== "object") {
    const b = Buffer.from(String(req.body), "latin1");
    if (b.length > maxBytes) throw new HttpError(413, "Fichier trop volumineux.");
    return b;
  }
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > maxBytes) throw new HttpError(413, "Fichier trop volumineux.");
    return req.body;
  }
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) throw new HttpError(413, "Fichier trop volumineux.");
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) { reject(new HttpError(413, "Fichier trop volumineux.")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

/** Enveloppe un handler : méthodes autorisées, erreurs propres, aucune fuite de détail interne. */
function handler(methods, fn) {
  return async (req, res) => {
    try {
      if (!methods.includes(req.method)) {
        return send(res, 405, { ok: false, error: "Méthode non autorisée." }, { Allow: methods.join(", ") });
      }
      await fn(req, res);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { ok: false, error: e.message, ...(e.extra || {}) });
      if (e instanceof ConfigError) {
        console.error("[config]", e.message);
        return send(res, 503, { ok: false, error: "Service momentanément indisponible." });
      }
      console.error("[erreur]", e && e.code, e && e.message);
      return send(res, 500, { ok: false, error: "Erreur interne. Réessayez plus tard." });
    }
  };
}

module.exports = { HttpError, send, getQuery, readBody, readRaw, parseCookies, handler };
