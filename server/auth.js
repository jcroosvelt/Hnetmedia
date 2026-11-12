"use strict";
/**
 * Authentification de l'administration (option A : maison, sans service tiers).
 *  - Mots de passe : scrypt (module crypto de Node), sel aléatoire, comparaison
 *    à temps constant. Format stocké : scrypt$N$r$p$sel$empreinte (base64url).
 *  - Session : jeton aléatoire de 256 bits dans un cookie HttpOnly, Secure,
 *    SameSite=Strict, préfixe __Host-. En base, seule son empreinte SHA-256.
 *  - CSRF : jeton par session, à renvoyer dans l'en-tête X-CSRF-Token pour
 *    toute requête qui modifie quelque chose, + vérification de l'Origin.
 *  - Verrouillage temporaire après échecs répétés + rate limiting.
 */
const crypto = require("crypto");
const { getDb } = require("./db");
const { HttpError, parseCookies } = require("./http");
const { randomToken, sha256, safeEqual, checkOrigin, clientIp, fingerprint } = require("./security");
const { limit } = require("./ratelimit");

const COOKIE = "__Host-hnet_session";
const SESSION_HOURS = 8;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, keylen: 64 };
const MIN_PASSWORD = 12;

function scryptAsync(password, salt, { N, r, p, keylen }) {
  return new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, keylen, { N, r, p, maxmem: 256 * 1024 * 1024 }, (e, k) => (e ? reject(e) : resolve(k))));
}

function checkPasswordPolicy(password) {
  const pw = String(password || "");
  if (pw.length < MIN_PASSWORD) throw new HttpError(400, `Mot de passe trop court (${MIN_PASSWORD} caractères minimum).`, { field: "password" });
  if (pw.length > 200) throw new HttpError(400, "Mot de passe trop long.", { field: "password" });
  return pw;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(String(password).normalize("NFKC"), salt, SCRYPT);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

async function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, "base64url");
  const key = await scryptAsync(String(password).normalize("NFKC"), Buffer.from(salt, "base64url"),
    { N: Number(N), r: Number(r), p: Number(p), keylen: expected.length });
  return crypto.timingSafeEqual(key, expected);
}

// Empreinte factice pour garder un temps de réponse constant quand le compte n'existe pas.
let dummyHash = null;
async function getDummyHash() { return dummyHash || (dummyHash = await hashPassword(randomToken())); }

function sessionCookie(token, maxAgeSeconds) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

async function audit(userId, action, entity, entityId, details) {
  await getDb().query(
    "INSERT INTO audit_log (user_id, action, entity, entity_id, details) VALUES ($1, $2, $3, $4, $5::jsonb)",
    [userId || null, action, entity || null, entityId == null ? null : String(entityId), details ? JSON.stringify(details) : null]
  );
}

/** Connexion. Retourne { cookie, csrfToken, user }. Message d'erreur volontairement générique. */
async function login(req, email, password) {
  const db = getDb();
  const ipKey = fingerprint(clientIp(req));
  await limit(`login:ip:${ipKey}`, 20, 900, "Trop de tentatives de connexion. Réessayez dans 15 minutes.");
  await limit(`login:email:${fingerprint(email)}`, 10, 900, "Trop de tentatives de connexion. Réessayez dans 15 minutes.");

  const rows = await db.query(
    `SELECT u.id, u.email, u.display_name, u.password_hash, u.active, u.locked_until, u.failed_logins, r.code AS role
     FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = $1`, [email]);
  const u = rows[0];
  const generic = new HttpError(401, "Identifiants incorrects.");

  if (!u || !u.password_hash) { await verifyPassword(password, await getDummyHash()); throw generic; }
  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    await verifyPassword(password, await getDummyHash());
    throw new HttpError(423, `Compte temporairement verrouillé après plusieurs échecs. Réessayez dans ${LOCK_MINUTES} minutes.`);
  }
  const ok = await verifyPassword(password, u.password_hash);
  if (!ok || !u.active) {
    if (!ok) {
      const upd = await db.query(
        `UPDATE users SET failed_logins = failed_logins + 1,
           locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
         WHERE id = $1 RETURNING failed_logins`, [u.id, MAX_FAILS, LOCK_MINUTES]);
      // Sécurité : les administrateurs sont prévenus au moment précis où un compte se verrouille.
      if (upd[0] && upd[0].failed_logins === MAX_FAILS) {
        await require("./push").notify({ permission: "user.manage", channel: "messages", title: "Compte verrouillé", body: `${u.display_name} : ${MAX_FAILS} échecs de connexion`, url: "/admin#/comptes" });
      }
      await audit(u.id, "login.echec", "user", u.id);
    }
    throw generic;
  }

  const token = randomToken(32);
  const csrf = randomToken(32);
  await db.transaction([
    { text: "UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1", params: [u.id] },
    {
      text: `INSERT INTO sessions (token_hash, user_id, csrf_secret, expires_at, ip_hash, user_agent)
             VALUES ($1, $2, $3, now() + make_interval(hours => $4), $5, $6)`,
      params: [sha256(token), u.id, csrf, SESSION_HOURS, ipKey, String(req.headers["user-agent"] || "").slice(0, 300)],
    },
    { text: "INSERT INTO audit_log (user_id, action, entity, entity_id) VALUES ($1, 'login.ok', 'user', $2)", params: [u.id, String(u.id)] },
  ]);
  // Ménage : sessions expirées de cet utilisateur.
  db.query("DELETE FROM sessions WHERE user_id = $1 AND expires_at < now() - interval '1 day'", [u.id]).catch(() => {});

  return {
    cookie: sessionCookie(token, SESSION_HOURS * 3600),
    csrfToken: csrf,
    user: { id: u.id, email: u.email, name: u.display_name, role: u.role },
  };
}

/** Lit la session du cookie. Retourne null si absente / expirée / révoquée. */
async function getSession(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token || token.length > 100) return null;
  const rows = await getDb().query(
    `SELECT s.token_hash, s.csrf_secret, u.id, u.email, u.display_name, u.active, r.code AS role,
            COALESCE(array_agg(rp.permission_code) FILTER (WHERE rp.permission_code IS NOT NULL), '{}') AS perms
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN role_permissions rp ON rp.role_id = r.id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
     GROUP BY s.token_hash, s.csrf_secret, u.id, u.email, u.display_name, u.active, r.code`,
    [sha256(token)]);
  const s = rows[0];
  if (!s || !s.active) return null;
  return {
    tokenHash: s.token_hash,
    csrf: s.csrf_secret,
    user: { id: s.id, email: s.email, name: s.display_name, role: s.role },
    perms: new Set(s.perms),
  };
}

/**
 * Exige une session valide (401), le CSRF pour les méthodes qui modifient
 * (403) et, si demandé, une permission (403).
 */
async function requireAuth(req, permission) {
  const s = await getSession(req);
  if (!s) throw new HttpError(401, "Session expirée ou absente. Reconnectez-vous.");
  if (!["GET", "HEAD"].includes(req.method)) {
    checkOrigin(req);
    const sent = req.headers["x-csrf-token"];
    if (!sent || !safeEqual(sent, s.csrf)) throw new HttpError(403, "Jeton de sécurité invalide. Rechargez la page.");
  }
  if (permission && !s.perms.has(permission)) throw new HttpError(403, "Vous n'avez pas les droits pour cette action.");
  return s;
}

const can = (s, perm) => s.perms.has(perm);

async function logout(req) {
  const s = await getSession(req);
  if (s) {
    await getDb().query("UPDATE sessions SET revoked_at = now() WHERE token_hash = $1", [s.tokenHash]);
    await audit(s.user.id, "logout", "user", s.user.id);
  }
  return sessionCookie("", 0);
}

module.exports = {
  COOKIE, hashPassword, verifyPassword, checkPasswordPolicy, login, logout,
  getSession, requireAuth, can, audit, sessionCookie,
};
