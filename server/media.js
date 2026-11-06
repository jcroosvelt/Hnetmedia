"use strict";
/**
 * Images téléversées : validation par le CONTENU (pas par le type annoncé), stockage dans Neon, liste.
 * Formats : JPEG, PNG, WebP (jamais SVG ni GIF : un SVG peut contenir du script).
 * Le navigateur réduit déjà l'image (≤ 1 600 px, WebP) ; le serveur revérifie tout.
 */
const crypto = require("crypto");
const { getDb } = require("./db");
const { HttpError, readRaw } = require("./http");
const { limit } = require("./ratelimit");
const { can, audit } = require("./auth");

const MAX_BYTES = 2 * 1024 * 1024;      // par image (la limite de Vercel est 4,5 Mo)
const MAX_TOTAL = 200 * 1024 * 1024;    // garde-fou : stockage total des images
const MAX_SIDE = 8000;                  // pixels
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reconnaît le format et lit les dimensions dans l'en-tête du fichier. null si ce n'est pas une image acceptée. */
function sniff(b) {
  if (b.length < 32) return null;
  // PNG
  if (b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && b.toString("latin1", 12, 16) === "IHDR") {
    return { mime: "image/png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  // JPEG
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { mime: "image/jpeg", height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      }
      if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue; }
      i += 2 + b.readUInt16BE(i + 2);
    }
    return null;
  }
  // WebP
  if (b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") {
    const kind = b.toString("latin1", 12, 16);
    if (kind === "VP8 " && b.length > 30) return { mime: "image/webp", width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (kind === "VP8L" && b.length > 25) { const v = b.readUInt32LE(21); return { mime: "image/webp", width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
    if (kind === "VP8X" && b.length > 30) return { mime: "image/webp", width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  }
  return null;
}

async function upload(s, req) {
  const db = getDb();
  await limit(`media:${s.user.id}`, 40, 3600, "Trop d'images envoyées en peu de temps. Réessayez dans une heure.");
  const body = await readRaw(req, MAX_BYTES);
  if (!body.length) throw new HttpError(400, "Aucun fichier reçu.");
  const info = sniff(body);
  if (!info) throw new HttpError(415, "Format non pris en charge. Utilisez une image JPEG, PNG ou WebP.");
  if (!(info.width >= 1 && info.height >= 1 && info.width <= MAX_SIDE && info.height <= MAX_SIDE)) {
    throw new HttpError(400, `Dimensions invalides (maximum ${MAX_SIDE} px de côté).`);
  }
  const used = (await db.query("SELECT COALESCE(SUM(m.size_bytes), 0)::bigint AS n FROM media m JOIN media_files f ON f.media_id = m.id"))[0].n;
  if (Number(used) + body.length > MAX_TOTAL) {
    throw new HttpError(507, "La médiathèque est pleine. Contactez l'administrateur pour libérer de l'espace.");
  }
  const id = crypto.randomUUID();
  await db.transaction([
    { text: `INSERT INTO media (id, url, alt, mime_type, width, height, size_bytes, uploaded_by) VALUES ($1, $2, '', $3, $4, $5, $6, $7)`,
      params: [id, `/media/${id}`, info.mime, info.width, info.height, body.length, s.user.id] },
    // Octets passés en hexadécimal : même comportement avec le pilote HTTP de Neon et avec pg.
    { text: `INSERT INTO media_files (media_id, data) VALUES ($1, decode($2, 'hex'))`, params: [id, body.toString("hex")] },
  ]);
  await audit(s.user.id, "media.televersement", "media", id, { mime: info.mime, octets: body.length });
  return { id, url: `/media/${id}`, width: info.width, height: info.height, size: body.length, mime: info.mime };
}

async function list(s) {
  const own = can(s, "media.manage") ? "" : "AND m.uploaded_by = $1";
  const rows = await getDb().query(
    `SELECT m.id, m.url, m.width, m.height, m.size_bytes AS size, m.created_at AS "createdAt", u.display_name AS "by"
     FROM media m JOIN media_files f ON f.media_id = m.id LEFT JOIN users u ON u.id = m.uploaded_by
     WHERE true ${own} ORDER BY m.created_at DESC LIMIT 60`, own ? [s.user.id] : []);
  return rows;
}

/** Sert l'image (route publique /media/<id>). Contenu immuable : cache d'un an. */
async function serve(req, res, id) {
  if (!UUID_RE.test(String(id || ""))) { res.statusCode = 404; res.setHeader("Content-Type", "text/plain; charset=utf-8"); return res.end("Introuvable"); }
  const etag = `"${String(id).toLowerCase()}"`;
  if (req.headers["if-none-match"] === etag) { res.statusCode = 304; res.setHeader("ETag", etag); return res.end(); }
  const rows = await getDb().query(
    "SELECT m.mime_type, encode(f.data, 'hex') AS hex FROM media m JOIN media_files f ON f.media_id = m.id WHERE m.id = $1", [id]);
  if (!rows.length) { res.statusCode = 404; res.setHeader("Content-Type", "text/plain; charset=utf-8"); res.setHeader("Cache-Control", "public, max-age=60"); return res.end("Introuvable"); }
  const buf = Buffer.from(rows[0].hex, "hex");
  res.statusCode = 200;
  res.setHeader("Content-Type", rows[0].mime_type);
  res.setHeader("Content-Length", String(buf.length));
  res.setHeader("Cache-Control", "public, max-age=31536000, s-maxage=31536000, immutable");
  res.setHeader("ETag", etag);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.end(req.method === "HEAD" ? undefined : buf);
}

module.exports = { upload, list, serve, sniff, MAX_BYTES, UUID_RE };
