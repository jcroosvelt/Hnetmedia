"use strict";
/**
 * Tests de bout en bout des fonctions /api contre un PostgreSQL LOCAL
 * (jamais Neon) : base recréée à chaque exécution avec les migrations.
 *
 *   TEST_PG_ADMIN_URL=postgres://postgres@127.0.0.1:5433/postgres npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { execFileSync } = require("child_process");
const path = require("path");

const ADMIN_URL = process.env.TEST_PG_ADMIN_URL || "postgres://postgres@127.0.0.1:5433/postgres";
const TEST_DB = "hnet_test";
const DB_URL = ADMIN_URL.replace(/\/[^/]*$/, "/" + TEST_DB);

Object.assign(process.env, {
  DB_DRIVER: "pg",
  DATABASE_URL: DB_URL,
  HASH_SECRET: "secret-de-test-0123456789abcdef0123456789",
  RESEND_API_KEY: "test", EMAIL_FROM: "newsletter@example.org", EMAIL_TEST_SINK: "1",
  ADMIN_SETUP_TOKEN: "code-installation-test-0123456789",
  SITE_URL: "https://www.hnetmedia.com",
  CRON_SECRET: "secret-cron-de-test-0123456789abcdef",
});

const ROOT = path.join(__dirname, "..");
let server, base, hookCalls = 0, hookServer;
const sent = () => (global.__sentEmails = global.__sentEmails || []);

async function resetDb() {
  const { Client } = require("pg");
  const c = new Client({ connectionString: ADMIN_URL });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await c.query(`CREATE DATABASE ${TEST_DB}`);
  await c.end();
  execFileSync("node", ["db/migrate.js"], { cwd: ROOT, env: process.env, stdio: "pipe" });
}

const routes = {
  "/api/contact": require("../api/contact"),
  "/api/comments": require("../api/comments"),
  "/api/newsletter": require("../api/newsletter"),
  "/api/views": require("../api/views"),
  "/api/admin": require("../api/admin"),
  "/api/health": require("../api/health"),
  "/api/media": require("../api/media"),
  "/api/scheduled": require("../api/scheduled"),
};

test.before(async () => {
  await resetDb();
  hookServer = http.createServer((req, res) => { hookCalls++; res.end("ok"); });
  await new Promise((r) => hookServer.listen(0, "127.0.0.1", r));
  process.env.VERCEL_DEPLOY_HOOK_URL = `http://127.0.0.1:${hookServer.address().port}/hook`;
  server = http.createServer((req, res) => {
    const p = new URL(req.url, "http://x").pathname;
    const key = Object.keys(routes).find((k) => p === k || p.startsWith(k + "/"));
    if (!key) { res.statusCode = 404; return res.end(); }
    return routes[key](req, res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  server.close(); hookServer.close();
  await require("../server/db").getDb().end();
});

const db = () => require("../server/db").getDb();
/** Image principale de test (obligatoire pour soumettre ou publier un article). */
async function giveImage(id) {
  const m = (await db().query("INSERT INTO media (url, alt) VALUES ('/media/test-image', 'Image de test') RETURNING id"))[0];
  await db().query("UPDATE articles SET main_media_id = $2 WHERE id = $1", [id, m.id]);
}

async function call(method, p, { body, origin = base, headers = {}, cookie, raw } = {}) {
  const h = { ...headers };
  if (origin) h.origin = origin;
  if (cookie) h.cookie = cookie;
  if (body !== undefined && !raw) h["content-type"] = "application/json";
  const r = await fetch(base + p, { method, headers: h, body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let json = null; try { json = JSON.parse(t); } catch { /* CSV, vide */ }
  return { status: r.status, json, text: t, headers: r.headers };
}
const formTs = () => Date.now() - 5000;
const ip = (n) => ({ "x-forwarded-for": `10.0.0.${n}` });

/* ═════════════════════════ CONTACT ═════════════════════════ */
test("contact : protections et enregistrement réel", async () => {
  const ok = { name: "Marie Joseph", email: "marie@example.org", category: "Rédaction", subject: "Info", message: "Bonjour, voici une information vérifiée.", hp: "", ts: formTs() };
  assert.equal((await call("GET", "/api/contact")).status, 405);
  assert.equal((await call("POST", "/api/contact", { body: ok, origin: null, headers: ip(1) })).status, 403, "Origin absente");
  assert.equal((await call("POST", "/api/contact", { body: ok, origin: "https://evil.example", headers: ip(1) })).status, 403, "Origin étrangère");
  assert.equal((await call("POST", "/api/contact", { body: { ...ok, hp: "http://spam" }, headers: ip(1) })).status, 400, "champ piège");
  assert.equal((await call("POST", "/api/contact", { body: { ...ok, ts: Date.now() }, headers: ip(1) })).status, 400, "trop rapide");
  assert.equal((await call("POST", "/api/contact", { body: { ...ok, email: "pas-un-email" }, headers: ip(1) })).status, 400);
  assert.equal((await call("POST", "/api/contact", { body: { ...ok, category: "Inventée" }, headers: ip(1) })).status, 400);
  assert.equal((await call("POST", "/api/contact", { body: { ...ok, message: "court" }, headers: ip(1) })).status, 400);
  const r = await call("POST", "/api/contact", { body: { ...ok, name: "Marie\u0000 Joseph" }, headers: ip(1) });
  assert.equal(r.status, 200, r.text);
  const rows = await db().query("SELECT name, email, ip_hash, status FROM contact_messages");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Marie Joseph", "caractères de contrôle retirés");
  assert.equal(rows[0].status, "nouveau");
  assert.ok(rows[0].ip_hash && !rows[0].ip_hash.includes("10.0.0"), "IP jamais stockée en clair");
  for (let i = 0; i < 4; i++) assert.equal((await call("POST", "/api/contact", { body: ok, headers: ip(1) })).status, 200);
  assert.equal((await call("POST", "/api/contact", { body: ok, headers: ip(1) })).status, 429, "rate limiting");
  assert.equal((await call("POST", "/api/contact", { body: ok, headers: ip(2) })).status, 200, "autre IP non bloquée");
});

/* ═════════════════════════ NEWSLETTER ═════════════════════════ */
test("newsletter : double confirmation, désinscription, honnêteté", async () => {
  const sub = (extra = {}, h = ip(20)) => call("POST", "/api/newsletter/subscribe", { body: { email: "Lecteur@Example.org", consent: true, hp: "", ts: formTs(), ...extra }, headers: h });

  const key = process.env.RESEND_API_KEY; delete process.env.RESEND_API_KEY;
  const off = await sub({}, ip(21));
  assert.equal(off.status, 503, "sans fournisseur e-mail : service non activé, pas de fausse confirmation");
  process.env.RESEND_API_KEY = key;
  assert.equal((await db().query("SELECT count(*)::int n FROM subscribers"))[0].n, 0);

  assert.equal((await sub({ consent: false })).status, 400, "consentement obligatoire");
  assert.equal((await sub({ email: "x@" })).status, 400);

  const before = sent().length;
  const r = await sub();
  assert.equal(r.status, 200, r.text);
  assert.equal(sent().length, before + 1, "un e-mail de confirmation envoyé");
  const mail = sent()[sent().length - 1];
  assert.equal(mail.to, "lecteur@example.org");
  const token = /token=([A-Za-z0-9_-]+)/.exec(mail.text)[1];
  let s = (await db().query("SELECT status, consent_text, confirm_token_hash FROM subscribers"))[0];
  assert.equal(s.status, "en_attente");
  assert.ok(s.consent_text.includes("J'accepte"), "texte du consentement conservé");
  assert.notEqual(s.confirm_token_hash, token, "jeton stocké uniquement sous forme d'empreinte");

  assert.equal((await call("POST", "/api/newsletter/confirm", { body: { token: "faux" }, headers: ip(20) })).status, 400);
  assert.equal((await call("POST", "/api/newsletter/confirm", { body: { token }, headers: ip(20) })).status, 200);
  assert.equal((await call("POST", "/api/newsletter/confirm", { body: { token }, headers: ip(20) })).status, 400, "lien à usage unique");
  s = (await db().query("SELECT status, confirmed_at, unsubscribe_token FROM subscribers"))[0];
  assert.equal(s.status, "confirme");

  const n = sent().length;
  const again = await sub({}, ip(22));
  assert.equal(again.status, 200);
  assert.equal(again.json.message, r.json.message, "même réponse : on ne révèle pas qui est inscrit");
  assert.equal(sent().length, n, "aucun e-mail renvoyé à un abonné déjà confirmé");

  // Désinscription « en un clic » (client mail, sans Origin)
  const u = await call("POST", `/api/newsletter/unsubscribe?token=${s.unsubscribe_token}`, {
    origin: null, raw: "List-Unsubscribe=One-Click", headers: { ...ip(23), "content-type": "application/x-www-form-urlencoded" } });
  assert.equal(u.status, 200, u.text);
  assert.equal((await db().query("SELECT status FROM subscribers"))[0].status, "desinscrit");
  assert.equal((await call("POST", "/api/newsletter/unsubscribe", { body: { token: "inconnu" }, headers: ip(23) })).status, 400);
  assert.equal((await call("POST", "/api/newsletter/inconnue", { body: {}, headers: ip(23) })).status, 404);

  // Réinscription après désinscription : nouveau cycle de confirmation
  assert.equal((await sub({}, ip(24))).status, 200);
  assert.equal((await db().query("SELECT status FROM subscribers"))[0].status, "en_attente");
});

/* ═════════════════════════ VUES ═════════════════════════ */
test("compteur de vues et « les plus lus »", async () => {
  await db().query(`INSERT INTO articles (id, slug, status, category_slug, published_at, author_name) VALUES
    ('a-pub', 'article-public', 'publie', 'politique', now() - interval '1 hour', 'Rédaction'),
    ('a-brouillon', 'article-brouillon', 'brouillon', 'politique', NULL, NULL)`);
  await db().query(`INSERT INTO article_translations (article_id, lang, title, content, reviewed) VALUES
    ('a-pub', 'fr', 'Un article public', '<p>x</p>', true), ('a-brouillon', 'fr', 'Secret', '<p>x</p>', true)`);
  const ua = { "user-agent": "Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile" };
  const view = (p, h) => call("POST", "/api/views", { body: { path: p }, headers: { ...ua, ...h } });
  const count = async () => (await db().query("SELECT COALESCE(SUM(views),0)::int n FROM page_views"))[0].n;

  assert.equal((await view("/article/article-public", ip(30))).status, 204);
  assert.equal(await count(), 1);
  await view("/article/article-public", ip(30));
  assert.equal(await count(), 1, "rechargement du même visiteur ignoré (30 min)");
  await view("/article/article-public.html", ip(31));
  assert.equal(await count(), 2, "autre visiteur compté");
  await call("POST", "/api/views", { body: { path: "/article/article-public" }, headers: { ...ip(32), "user-agent": "Googlebot/2.1" } });
  await view("/article/article-public", { ...ip(33), dnt: "1" });
  await view("/article/article-public", { ...ip(34), "sec-gpc": "1" });
  await view("/article/article-brouillon", ip(35));
  await view("/article/n-existe-pas", ip(36));
  await view("/../../etc/passwd", ip(37));
  assert.equal(await count(), 2, "robots, DNT/GPC, brouillons, articles inconnus et chemins invalides ignorés");
  const cols = await db().query("SELECT * FROM page_views");
  assert.deepEqual(Object.keys(cols[0]).sort(), ["article_id", "bucket", "path", "views"], "aucune donnée personnelle dans page_views");

  const top = await call("GET", "/api/views?top=lus");
  assert.equal(top.status, 200);
  assert.equal(top.json.items.length, 1);
  assert.equal(top.json.items[0].slug, "article-public");
  assert.equal(top.json.items[0].views, undefined, "aucun chiffre d'audience exposé");
  assert.match(top.headers.get("cache-control"), /s-maxage/);
  assert.equal((await call("GET", "/api/views?top=tendances")).json.items.length, 0, "pas de « tendance » sous le seuil de 5 vues");
  assert.equal((await call("GET", "/api/views?top=xss")).status, 400);
});

/* ═════════════════════════ ADMIN ═════════════════════════ */
async function loginAs(email, password, n) {
  const r = await call("POST", "/api/admin/auth/login", { body: { email, password }, headers: ip(n) });
  assert.equal(r.status, 200, `connexion ${email} : ${r.text}`);
  const cookie = r.headers.get("set-cookie").split(";")[0];
  return { cookie, csrf: r.json.csrfToken, user: r.json.user };
}
const as = (s, method, p, body) => call(method, p, { body, cookie: s.cookie, headers: { "x-csrf-token": s.csrf } });

test("admin : installation, connexion, sessions, CSRF", async () => {
  let r = await call("GET", "/api/admin/auth/session");
  assert.equal(r.status, 401);
  assert.equal(r.json.needsSetup, true);

  const setup = { setupToken: "mauvais-code-mauvais-code-000", email: "admin@hnetmedia.com", name: "Admin", password: "un mot de passe solide 2026" };
  assert.equal((await call("POST", "/api/admin/auth/setup", { body: setup, headers: ip(40) })).status, 403);
  assert.equal((await call("POST", "/api/admin/auth/setup", { body: { ...setup, setupToken: process.env.ADMIN_SETUP_TOKEN, password: "court" }, headers: ip(40) })).status, 400);
  assert.equal((await call("POST", "/api/admin/auth/setup", { body: { ...setup, setupToken: process.env.ADMIN_SETUP_TOKEN }, headers: ip(40) })).status, 201);
  assert.equal((await call("POST", "/api/admin/auth/setup", { body: { ...setup, setupToken: process.env.ADMIN_SETUP_TOKEN }, headers: ip(40) })).status, 409, "installation à usage unique");
  const stored = (await db().query("SELECT password_hash FROM users"))[0].password_hash;
  assert.match(stored, /^scrypt\$131072\$8\$1\$/, "mot de passe haché avec scrypt");
  assert.ok(!stored.includes("solide"));

  assert.equal((await call("POST", "/api/admin/auth/login", { body: { email: "admin@hnetmedia.com", password: "faux mot de passe" }, headers: ip(41) })).status, 401);
  assert.equal((await call("POST", "/api/admin/auth/login", { body: { email: "inconnu@hnetmedia.com", password: "faux mot de passe" }, headers: ip(41) })).json.error,
    "Identifiants incorrects.", "même message que le compte existe ou non");

  const login = await call("POST", "/api/admin/auth/login", { body: { email: "ADMIN@hnetmedia.com", password: setup.password }, headers: ip(42) });
  assert.equal(login.status, 200);
  const sc = login.headers.get("set-cookie");
  for (const flag of ["__Host-hnet_session=", "HttpOnly", "Secure", "SameSite=Strict", "Path=/"]) assert.ok(sc.includes(flag), `cookie : ${flag}`);
  const admin = { cookie: sc.split(";")[0], csrf: login.json.csrfToken };
  const tokenInDb = (await db().query("SELECT token_hash FROM sessions"))[0].token_hash;
  assert.notEqual(tokenInDb, admin.cookie.split("=")[1], "seule l'empreinte du jeton est en base");

  r = await call("GET", "/api/admin/auth/session", { cookie: admin.cookie });
  assert.equal(r.status, 200);
  assert.equal(r.json.user.role, "administrateur");
  assert.equal(r.json.permissions.length, 24);

  const newUser = { email: "chef@hnetmedia.com", name: "Chef", role: "redacteur_en_chef", password: "mot de passe du chef 2026" };
  assert.equal((await call("POST", "/api/admin/users", { body: newUser, cookie: admin.cookie })).status, 403, "sans jeton CSRF");
  assert.equal((await call("POST", "/api/admin/users", { body: newUser, cookie: admin.cookie, headers: { "x-csrf-token": "faux" } })).status, 403, "jeton CSRF faux");
  assert.equal((await call("POST", "/api/admin/users", { body: newUser, cookie: admin.cookie, origin: "https://evil.example", headers: { "x-csrf-token": admin.csrf } })).status, 403, "Origin étrangère");
  assert.equal((await as(admin, "POST", "/api/admin/users", newUser)).status, 201);
  assert.equal((await as(admin, "POST", "/api/admin/users", newUser)).status, 409, "doublon d'e-mail");

  // Garde-fous sur les comptes
  const me = (await db().query("SELECT id FROM users WHERE email = 'admin@hnetmedia.com'"))[0].id;
  assert.equal((await as(admin, "PATCH", `/api/admin/users/${me}`, { active: false })).status, 400, "pas d'auto-désactivation");
  assert.equal((await as(admin, "PATCH", `/api/admin/users/${me}`, { role: "journaliste" })).status, 400, "pas d'auto-rétrogradation");

  // Verrouillage après 5 échecs
  for (let i = 0; i < 5; i++) await call("POST", "/api/admin/auth/login", { body: { email: newUser.email, password: "erreur erreur erreur" }, headers: ip(50 + i) });
  r = await call("POST", "/api/admin/auth/login", { body: { email: newUser.email, password: newUser.password }, headers: ip(60) });
  assert.equal(r.status, 423, "compte verrouillé même avec le bon mot de passe");
  const chefId = (await db().query("SELECT id FROM users WHERE email = $1", [newUser.email]))[0].id;
  assert.equal((await as(admin, "PATCH", `/api/admin/users/${chefId}`, { unlock: true })).status, 200);
  await loginAs(newUser.email, newUser.password, 61);

  // Déconnexion : la session est révoquée côté serveur
  const tmp = await loginAs("admin@hnetmedia.com", setup.password, 62);
  const out = await call("POST", "/api/admin/auth/logout", { cookie: tmp.cookie });
  assert.match(out.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await call("GET", "/api/admin/auth/session", { cookie: tmp.cookie })).status, 401, "session révoquée");
});

test("admin : rôles et permissions minimales sur les articles", async () => {
  const admin = await loginAs("admin@hnetmedia.com", "un mot de passe solide 2026", 70);
  const pw = "mot de passe de test 2026";
  for (const [email, role] of [["contrib@h.com", "contributeur"], ["journa@h.com", "journaliste"], ["editeur@h.com", "editeur"], ["com@h.com", "commercial"]]) {
    assert.equal((await as(admin, "POST", "/api/admin/users", { email, name: role, role, password: pw })).status, 201);
  }
  const contrib = await loginAs("contrib@h.com", pw, 71);
  const journa = await loginAs("journa@h.com", pw, 72);
  const editeur = await loginAs("editeur@h.com", pw, 73);
  const com = await loginAs("com@h.com", pw, 74);
  const chef = await loginAs("chef@hnetmedia.com", "mot de passe du chef 2026", 75);

  // Le contributeur crée un brouillon
  let r = await as(contrib, "POST", "/api/admin/articles", { title: "Élections : le calendrier officiel", category: "politique" });
  assert.equal(r.status, 201, r.text);
  const art = r.json.article;
  assert.equal(art.status, "brouillon");
  assert.equal(art.slug, "elections-le-calendrier-officiel");
  assert.equal(art.rights.publish, false);

  // Nettoyage du HTML (XSS) et traduction non validable par un contributeur
  r = await as(contrib, "PUT", `/api/admin/articles/${art.id}`, {
    translations: {
      fr: { title: "Élections : le calendrier <b>officiel</b>", excerpt: "Chapeau", content: `<p onclick="x()">Texte</p><script>alert(1)</script><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">lien</a><a href="https://cep.ht">CEP</a>` },
      en: { title: "Elections: the official calendar", content: "<p>Text</p>", reviewed: true },
    },
    tags: ["Élections", "CEP"],
    sources: [{ name: "Conseil électoral provisoire", url: "https://cep.ht" }],
    featured: undefined,
  });
  assert.equal(r.status, 200, r.text);
  const fr = r.json.article.translations.fr;
  assert.equal(fr.title, "Élections : le calendrier officiel", "balises retirées du titre");
  assert.ok(!/script|onclick|onerror|javascript:/i.test(fr.content), `HTML nettoyé : ${fr.content}`);
  assert.ok(fr.content.includes('href="https://cep.ht"') && fr.content.includes("noopener"), "liens externes sûrs conservés");
  assert.equal(r.json.article.translations.en.reviewed, false, "un contributeur ne peut pas valider une traduction");
  assert.deepEqual(r.json.article.tags.map((t) => t.slug).sort(), ["cep", "elections"]);
  assert.equal((await as(contrib, "PUT", `/api/admin/articles/${art.id}`, { featured: true })).status, 403, "mise en avant réservée");

  // Le contributeur ne publie pas, ne voit pas les articles des autres
  assert.equal((await as(contrib, "POST", `/api/admin/articles/${art.id}/status`, { status: "publie" })).status, 403);
  const other = (await as(journa, "POST", "/api/admin/articles", { title: "Article du journaliste" })).json.article;
  assert.equal((await as(contrib, "GET", `/api/admin/articles/${other.id}`)).status, 403);
  assert.equal((await as(contrib, "PUT", `/api/admin/articles/${other.id}`, { translations: { fr: { title: "Piraté" } } })).status, 403);
  const listC = (await as(contrib, "GET", "/api/admin/articles")).json.items.map((a) => a.id);
  assert.ok(listC.includes(art.id) && !listC.includes(other.id) && !listC.includes("exemple-001"), "liste limitée à ses articles");

  // L'éditeur modifie tout, valide les traductions, mais ne publie pas
  r = await as(editeur, "PUT", `/api/admin/articles/${art.id}`, { translations: { en: { title: "Elections: the official calendar", content: "<p>Reviewed text</p>", reviewed: true } } });
  assert.equal(r.status, 200);
  assert.equal(r.json.article.translations.en.reviewed, true);
  assert.equal((await as(editeur, "POST", `/api/admin/articles/${art.id}/status`, { status: "publie" })).status, 403);

  // Le commercial : mention sponsorisé oui, contenu non, comptes non
  assert.equal((await as(com, "PUT", `/api/admin/articles/${art.id}`, { translations: { fr: { title: "Pub" } } })).status, 403);
  assert.equal((await as(com, "POST", `/api/admin/articles/${art.id}/sponsored`, { sponsored: true })).json.article.sponsored, true);
  assert.equal((await as(com, "POST", `/api/admin/articles/${art.id}/sponsored`, { sponsored: false })).status, 200);
  assert.equal((await as(com, "GET", "/api/admin/users")).status, 403);
  assert.equal((await as(com, "GET", "/api/admin/contact-messages")).status, 200, "le commercial lit les messages");
  assert.equal((await as(com, "PATCH", `/api/admin/contact-messages/00000000-0000-0000-0000-000000000000`, { status: "lu" })).status, 403);

  // Publication par le rédacteur en chef, avec contrôles
  r = await as(chef, "POST", `/api/admin/articles/${art.id}/status`, { status: "publie" });
  assert.equal(r.status, 400, "auteur manquant");
  await as(chef, "PUT", `/api/admin/articles/${art.id}`, { authorName: "La rédaction" });
  assert.equal((await as(chef, "POST", `/api/admin/articles/${art.id}/status`, { status: "programme", publishedAt: "2000-01-01T00:00:00Z" })).status, 400, "programmation dans le passé refusée");
  r = await as(chef, "POST", `/api/admin/articles/${art.id}/status`, { status: "publie" });
  assert.equal(r.status, 400, "image principale obligatoire");
  assert.ok(/image principale/i.test(r.json.error), "le message demande l'image principale : " + r.json.error);
  await giveImage(art.id);
  const hooksBefore = hookCalls;
  r = await as(chef, "POST", `/api/admin/articles/${art.id}/status`, { status: "publie" });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.article.status, "publie");
  assert.ok(r.json.article.publishedAt);
  assert.equal(r.json.article.rebuildTriggered, true);
  assert.equal(hookCalls, hooksBefore + 1, "hook de rebuild Vercel appelé à la publication");

  // Une fois publié, le contributeur ne peut plus le modifier
  assert.equal((await as(contrib, "PUT", `/api/admin/articles/${art.id}`, { translations: { fr: { title: "Changement" } } })).status, 403);
  // Correction publique
  r = await as(chef, "POST", `/api/admin/articles/${art.id}/corrections`, { text: "La date du second tour a été corrigée." });
  assert.equal(r.status, 201);
  assert.equal(r.json.article.corrections.length, 1);
  assert.equal((await as(journa, "POST", `/api/admin/articles/${art.id}/corrections`, { text: "x" })).status, 403);

  // Programmation
  r = await as(chef, "POST", `/api/admin/articles/${other.id}/status`, { status: "programme", publishedAt: new Date(Date.now() + 86400000).toISOString() });
  assert.equal(r.status, 400, "un article vide ne peut pas être programmé");

  // Suppression : administrateur uniquement
  assert.equal((await as(chef, "DELETE", `/api/admin/articles/${other.id}`)).status, 403);
  assert.equal((await as(admin, "DELETE", `/api/admin/articles/${other.id}`)).status, 200);

  // Journal d'audit
  const actions = (await db().query("SELECT action FROM audit_log")).map((x) => x.action);
  for (const a of ["login.ok", "login.echec", "article.creation", "article.statut.publie", "article.correction", "article.suppression", "compte.creation"]) {
    assert.ok(actions.includes(a), `audit : ${a}`);
  }
});

test("admin : abonnés, export CSV et statistiques", async () => {
  const admin = await loginAs("admin@hnetmedia.com", "un mot de passe solide 2026", 80);
  const chef = await loginAs("chef@hnetmedia.com", "mot de passe du chef 2026", 81);
  await db().query(`INSERT INTO subscribers (email, status, consent_text, confirmed_at) VALUES ('=cmd|calc@example.org', 'confirme', 'x', now())`);
  assert.equal((await as(chef, "GET", "/api/admin/subscribers")).status, 403, "liste des abonnés : administrateur uniquement");
  assert.equal((await as(chef, "GET", "/api/admin/subscribers/export")).status, 403);
  const stats = await as(chef, "GET", "/api/admin/subscribers/stats");
  assert.equal(stats.status, 200);
  assert.equal(stats.json.counts.confirme, 1);
  const csv = await as(admin, "GET", "/api/admin/subscribers/export");
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-type"), /text\/csv/);
  assert.ok(csv.text.includes(`"'=cmd|calc@example.org"`), "protection contre l'injection de formules dans le CSV");
  const views = await as(chef, "GET", "/api/admin/stats/views?days=7");
  assert.equal(views.status, 200);
  assert.ok(views.json.topArticles[0].views >= 1, "les chiffres détaillés restent internes");
  assert.equal((await call("GET", "/api/admin/stats/views")).status, 401, "sans session");
});

test("health : état minimal, sans fuite", async () => {
  const r = await call("GET", "/api/health");
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true, database: true, hashSecret: true, deployHook: true, push: false, siteUrl: "https://www.hnetmedia.com" }, "le test configure un faux Deploy Hook et une adresse de site ; pas de clé Firebase");
  assert.ok(!r.text.includes("postgres"), "aucune chaîne de connexion exposée");
  assert.equal((await call("POST", "/api/health")).status, 405);
});

test("textes : « & », guillemets et « < » enregistrés tels quels, stables à chaque sauvegarde", async () => {
  const admin = await loginAs("admin@hnetmedia.com", "un mot de passe solide 2026", 90);
  const title = 'Éducation & santé : « bilan » "2026" a < b';
  let r = await as(admin, "POST", "/api/admin/articles", { title, category: "sante" });
  assert.equal(r.status, 201, r.text);
  const id = r.json.article.id;
  assert.equal(r.json.article.translations.fr.title, title, "titre conservé à la création");
  for (let i = 0; i < 3; i++) {
    const cur = (await as(admin, "GET", `/api/admin/articles/${id}`)).json.article.translations.fr.title;
    r = await as(admin, "PUT", `/api/admin/articles/${id}`, { translations: { fr: { title: cur, excerpt: "R & D <b>gras</b> \"citation\"", content: "<p>Texte</p>" } } });
    assert.equal(r.status, 200, r.text);
  }
  assert.equal(r.json.article.translations.fr.title, title, "titre inchangé après 3 enregistrements (pas de &amp;amp;amp;)");
  assert.equal(r.json.article.translations.fr.excerpt, 'R & D gras "citation"', "balises retirées, & conservé");
});

test("JSON-LD : un titre ne peut pas fermer la balise <script>", () => {
  const { jsonForHtml } = require("../server/html");
  const piege = { headline: 'x</script><script>alert(1)</script> & <img src=x onerror=alert(2)>', n: "a\u2028b" };
  const out = jsonForHtml(piege);
  assert.ok(!/[<>&]/.test(out) && !out.includes("</script>"), "aucun < > & brut dans le JSON intégré à la page");
  assert.deepEqual(JSON.parse(out), piege, "le JSON se relit à l'identique");
});

test("e-mails : alerte à l'équipe possible sans domaine, newsletter refusée tant qu'aucun domaine n'est vérifié", async () => {
  const email = require("../server/email");
  const body = (extra = {}) => ({ name: "Jean <b>Test</b>", email: "lecteur@example.org", category: "Rédaction", subject: "Alerte", message: "Message de test assez long pour passer.", hp: "", ts: formTs(), ...extra });
  const saved = { from: process.env.EMAIL_FROM, notify: process.env.CONTACT_NOTIFY_EMAIL };
  try {
    process.env.EMAIL_FROM = "onboarding@resend.dev";
    process.env.CONTACT_NOTIFY_EMAIL = "equipe@example.org";
    assert.equal(email.isConfigured(), true);
    assert.equal(email.canSendToPublic(), false, "expéditeur de test Resend : pas d'envoi vers le public");

    const before = sent().length;
    const r = await call("POST", "/api/contact", { body: body(), headers: ip(120) });
    assert.equal(r.status, 200, r.text);
    assert.equal(sent().length, before + 1, "une alerte est envoyée à l'équipe");
    const m = sent()[sent().length - 1];
    assert.equal(m.to, "equipe@example.org");
    assert.equal(m.replyTo, "lecteur@example.org", "répondre écrit au visiteur");
    assert.match(m.from, /onboarding@resend\.dev/);
    assert.ok(!m.html.includes("<b>Test</b>") && m.html.includes("&lt;b&gt;"), "le contenu du visiteur est échappé dans l'e-mail");

    const n = sent().length;
    const nl = await call("POST", "/api/newsletter/subscribe", { body: { email: "x@example.org", consent: true, hp: "", ts: formTs() }, headers: ip(121) });
    assert.equal(nl.status, 503, "newsletter non activée sans domaine vérifié");
    assert.equal(sent().length, n, "aucun e-mail envoyé à un lecteur");
    assert.equal((await db().query("SELECT count(*)::int n FROM subscribers WHERE email = 'x@example.org'"))[0].n, 0, "aucun abonné enregistré à tort");

    process.env.EMAIL_FROM = "HNet <newsletter@example.org>";
    assert.equal(email.canSendToPublic(), true, "domaine propre : envoi vers le public possible");

    delete process.env.CONTACT_NOTIFY_EMAIL;
    const k = sent().length;
    assert.equal((await call("POST", "/api/contact", { body: body(), headers: ip(122) })).status, 200, "le contact marche aussi sans aucune alerte");
    assert.equal(sent().length, k, "pas d'alerte si aucune adresse n'est configurée");
  } finally {
    process.env.EMAIL_FROM = saved.from;
    if (saved.notify === undefined) delete process.env.CONTACT_NOTIFY_EMAIL; else process.env.CONTACT_NOTIFY_EMAIL = saved.notify;
  }
});

test("contact : « Droit de réponse » accepté (migration 0004) et refus d'un type inventé", async () => {
  const cats = (await db().query("SELECT value FROM site_settings WHERE key = 'contactCategories'"))[0].value;
  assert.ok(cats.includes("Droit de réponse") && cats[cats.length - 1] === "Autre", "liste : " + cats.join(", "));
  const body = (c) => ({ name: "Marie", email: "marie@example.org", category: c, message: "Je souhaite exercer mon droit de réponse.", hp: "", ts: formTs() });
  assert.equal((await call("POST", "/api/contact", { body: body("Droit de réponse"), headers: ip(130) })).status, 200);
  assert.equal((await call("POST", "/api/contact", { body: body("Type inventé"), headers: ip(130) })).status, 400);
});

/* ═════════════════════════ IMAGES TÉLÉVERSÉES ═════════════════════════ */
function fakeImage(kind, w = 1200, h = 800) {
  if (kind === "png") {
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from("IHDR"), ihdr, Buffer.alloc(4), Buffer.alloc(12, 1)]);
  }
  if (kind === "jpeg") {
    const sof = Buffer.alloc(17); sof[0] = 0xff; sof[1] = 0xc0; sof.writeUInt16BE(17 - 2 + 0, 2); sof[4] = 8; sof.writeUInt16BE(h, 5); sof.writeUInt16BE(w, 7); sof[9] = 3;
    return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), Buffer.from("JFIF\0"), Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0]), sof, Buffer.from([0xff, 0xd9])]);
  }
  if (kind === "webp") {
    const b = Buffer.alloc(40); b.write("RIFF", 0); b.writeUInt32LE(32, 4); b.write("WEBPVP8X", 8); b.writeUInt32LE(10, 16); b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3);
    return b;
  }
  throw new Error(kind);
}
const upload = (s, buf, extra = {}) => call("POST", "/api/admin/media", { raw: buf, cookie: s.cookie, headers: { "content-type": "application/octet-stream", ...(extra.noCsrf ? {} : { "x-csrf-token": s.csrf }) } });
const getMedia = (id, headers = {}) => fetch(`${base}/api/media?id=${id}`, { headers });

test("images : téléversement validé par le contenu, droits, service public en cache", async () => {
  const pw = "mot de passe de test 2026";
  const contrib = await loginAs("contrib@h.com", pw, 140);
  const com = await loginAs("com@h.com", pw, 141);
  const admin = await loginAs("admin@hnetmedia.com", "un mot de passe solide 2026", 142);

  assert.equal((await call("POST", "/api/admin/media", { raw: fakeImage("png") })).status, 401, "sans connexion");
  assert.equal((await upload(com, fakeImage("png"))).status, 403, "le rôle commercial n'a pas le droit de téléverser");
  assert.equal((await upload(contrib, fakeImage("png"), { noCsrf: true })).status, 403, "jeton CSRF obligatoire");

  const png = fakeImage("png", 1600, 900);
  let r = await upload(contrib, png);
  assert.equal(r.status, 201, r.text);
  const m = r.json.media;
  assert.match(m.url, /^\/media\/[0-9a-f-]{36}$/);
  assert.deepEqual([m.width, m.height, m.mime, m.size], [1600, 900, "image/png", png.length], "dimensions lues dans le fichier, pas annoncées par le client");
  const jpg = (await upload(contrib, fakeImage("jpeg", 800, 600))).json.media;
  const wbp = (await upload(contrib, fakeImage("webp", 1024, 768))).json.media;
  assert.deepEqual([jpg.mime, jpg.width, jpg.height, wbp.mime, wbp.width, wbp.height], ["image/jpeg", 800, 600, "image/webp", 1024, 768]);

  // service public : octets identiques, cache immuable, aucun script possible
  const img = await getMedia(m.id);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/png");
  assert.match(img.headers.get("cache-control"), /immutable/);
  assert.equal(img.headers.get("x-content-type-options"), "nosniff");
  assert.match(img.headers.get("content-security-policy"), /default-src 'none'/);
  assert.ok(Buffer.from(await img.arrayBuffer()).equals(png), "octets restitués à l'identique");
  assert.equal((await getMedia(m.id, { "if-none-match": img.headers.get("etag") })).status, 304, "cache conditionnel");
  assert.equal((await getMedia("00000000-0000-4000-8000-000000000000")).status, 404);
  assert.equal((await getMedia("../../etc/passwd")).status, 404);

  // faux fichiers : on regarde le contenu, pas le nom ni le type annoncé
  const pad = (s) => Buffer.concat([Buffer.from(s), Buffer.alloc(64, 32)]);
  for (const [nom, buf] of [["HTML déguisé", pad("<html><script>alert(1)</script>")], ["SVG", pad('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">')], ["GIF", pad("GIF89a")], ["PDF", pad("%PDF-1.7")], ["PNG tronqué", fakeImage("png").slice(0, 10)]]) {
    assert.equal((await upload(contrib, buf)).status, 415, nom + " refusé");
  }
  assert.equal((await upload(contrib, Buffer.alloc(0))).status, 400, "fichier vide");
  assert.equal((await upload(contrib, Buffer.concat([fakeImage("png"), Buffer.alloc(2 * 1024 * 1024)]))).status, 413, "plus de 2 Mo refusé");
  assert.equal((await upload(contrib, fakeImage("png", 9000, 100))).status, 400, "dimensions démesurées refusées");

  // liste : chacun voit les siennes ; l'administrateur voit tout
  const mine = (await as(contrib, "GET", "/api/admin/media")).json.items.map((x) => x.id);
  assert.ok([m.id, jpg.id, wbp.id].every((id) => mine.includes(id)));
  const other = (await upload(admin, fakeImage("png", 300, 300))).json.media;
  assert.ok(!(await as(contrib, "GET", "/api/admin/media")).json.items.some((x) => x.id === other.id), "un contributeur ne voit pas les images des autres");
  assert.ok((await as(admin, "GET", "/api/admin/media")).json.items.some((x) => x.id === m.id), "l'administrateur voit tout");

  // dans un article : images /media acceptées, chemins libres et http refusés, alignement seul toléré
  const art = (await as(contrib, "POST", "/api/admin/articles", { title: "Reportage photo", category: "culture" })).json.article;
  const content = `<p style="text-align:center;color:red;position:fixed">Centré</p><figure><img src="${m.url}" alt="Une"><figcaption>Légende</figcaption></figure>`
    + `<p><img src="/evil.png" alt="x"><img src="http://pas-https.example/a.png" alt="x"><img src="javascript:alert(1)" alt="x"><img src="//autre.example/a.png" alt="x"></p>`;
  r = await as(contrib, "PUT", `/api/admin/articles/${art.id}`, { translations: { fr: { title: "Reportage photo", content } }, mainImage: { url: m.url, alt: "Vue du port" } });
  assert.equal(r.status, 200, r.text);
  const saved = r.json.article.translations.fr.content;
  assert.ok(saved.includes(`src="${m.url}"`), "image téléversée conservée");
  assert.ok(/<p style="text-align:center">Centré<\/p>/.test(saved), "alignement conservé, autres styles retirés : " + saved.slice(0, 120));
  assert.ok(!/evil\.png|pas-https|javascript:|autre\.example/.test(saved), "chemins libres, http, javascript: et //hôte retirés");
  assert.equal(r.json.article.mainImage.url, m.url, "image principale téléversée acceptée");
  assert.equal((await as(contrib, "PUT", `/api/admin/articles/${art.id}`, { mainImage: { url: "/media/00000000-0000-4000-8000-000000000000", alt: "x" } })).status, 400, "image principale inconnue refusée");
  assert.equal((await as(contrib, "PUT", `/api/admin/articles/${art.id}`, { mainImage: { url: "http://x.example/a.png", alt: "x" } })).status, 400, "http refusé");
  assert.equal((await as(contrib, "PUT", `/api/admin/articles/${art.id}`, { mainImage: { url: "/media/pas-un-uuid", alt: "x" } })).status, 400);

  const stored = await db().query("SELECT length(data)::int n FROM media_files WHERE media_id = $1", [m.id]);
  assert.equal(stored[0].n, png.length, "octets enregistrés dans la base");
  assert.ok((await db().query("SELECT 1 FROM audit_log WHERE action = 'media.televersement'")).length >= 3, "téléversements journalisés");
});

/* ═════════════════════════ PUBLICATION PROGRAMMÉE ═════════════════════════ */
test("programmation : point d'entrée protégé, promotion à l'heure, articles incomplets jamais publiés à moitié", async () => {
  const secret = process.env.CRON_SECRET;
  const bearer = (x) => ({ authorization: `Bearer ${x}` });
  await db().query(`INSERT INTO articles (id, slug, status, category_slug, author_name, published_at) VALUES
    ('s-ok', 'prog-ok', 'programme', 'culture', 'Rédaction', now() - interval '2 minutes'),
    ('s-incomplet', 'prog-incomplet', 'programme', NULL, 'Rédaction', now() - interval '2 minutes'),
    ('s-futur', 'prog-futur', 'programme', 'culture', 'Rédaction', now() + interval '2 days')`);
  await db().query(`INSERT INTO article_translations (article_id, lang, title, content, reviewed) VALUES
    ('s-ok', 'fr', 'Programmé complet', '<p>Texte</p>', true), ('s-incomplet', 'fr', 'Programmé incomplet', '<p>Texte</p>', true), ('s-futur', 'fr', 'Programmé futur', '<p>Texte</p>', true)`);

  await giveImage("s-ok"); // sans image principale, un article programmé n'est jamais publié
  // sécurité du point d'entrée
  assert.equal((await call("GET", "/api/scheduled", { origin: null })).status, 401, "sans secret");
  assert.equal((await call("GET", "/api/scheduled", { origin: null, headers: bearer("pas-le-bon-secret-pas-le-bon-0000") })).status, 401, "mauvais secret");
  process.env.CRON_SECRET = "court"; assert.equal((await call("GET", "/api/scheduled", { origin: null, headers: bearer("court") })).status, 503, "secret trop court : point d'entrée fermé");
  delete process.env.CRON_SECRET; assert.equal((await call("GET", "/api/scheduled", { origin: null, headers: bearer("x") })).status, 503, "sans CRON_SECRET : fermé");
  process.env.CRON_SECRET = secret;
  assert.equal((await db().query("SELECT status::text s FROM articles WHERE id = 's-ok'"))[0].s, "programme", "rien n'a bougé sans secret valide");

  // le site (build) inclut déjà l'article échu et complet, jamais l'incomplet ni le futur
  const { loadContent } = require("../server/content");
  let slugs = (await loadContent()).articles.map((x) => x.slug);
  assert.ok(slugs.includes("prog-ok") && !slugs.includes("prog-incomplet") && !slugs.includes("prog-futur"), "lecture du build : " + slugs.join(","));

  // exécution (Vercel Cron appelle en GET)
  const before = hookCalls;
  let r = await call("GET", "/api/scheduled", { origin: null, headers: bearer(secret) });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.json.promoted, r.json.slugs, r.json.blocked, r.json.rebuild], [1, ["prog-ok"], ["prog-incomplet"], true]);
  assert.equal(hookCalls, before + 1, "reconstruction du site demandée");
  const st = Object.fromEntries((await db().query("SELECT id, status::text s FROM articles WHERE id LIKE 's-%'")).map((x) => [x.id, x.s]));
  assert.deepEqual(st, { "s-ok": "publie", "s-incomplet": "programme", "s-futur": "programme" });
  assert.ok((await db().query("SELECT 1 FROM audit_log WHERE action = 'article.statut.publie_auto' AND entity_id = 's-ok'")).length === 1, "promotion journalisée");
  assert.ok((await db().query("SELECT 1 FROM site_settings WHERE key = 'scheduledLastRun'")).length === 1, "dernière vérification enregistrée");

  // idempotent : une seconde exécution ne change rien et ne relance pas le site
  r = await call("POST", "/api/scheduled", { origin: null, headers: bearer(secret) });
  assert.deepEqual([r.status, r.json.promoted, r.json.rebuild], [200, 0, false]);
  assert.equal(hookCalls, before + 1);
  slugs = (await loadContent()).articles.map((x) => x.slug);
  assert.ok(slugs.includes("prog-ok") && !slugs.includes("prog-incomplet"), "toujours cohérent après promotion");

  // l'administration voit la dernière vérification (pour afficher un texte honnête)
  const admin = await loginAs("admin@hnetmedia.com", "un mot de passe solide 2026", 150);
  const meta = (await as(admin, "GET", "/api/admin/meta")).json;
  assert.ok(meta.scheduledLastRun && Date.now() - new Date(meta.scheduledLastRun).getTime() < 60000, "meta.scheduledLastRun renseigné");
});

/* ═════════════════════════ MÉDIAS, ÉQUIPE, PARTENAIRES, OFFRES, RÉGLAGES ═════════════════════════ */
test("médiathèque : suppression refusée tant que l'image sert, droits par rôle", async () => {
  const pw = "mot de passe de test 2026";
  const contrib = await loginAs("contrib@h.com", pw, 160);
  const editeur = await loginAs("editeur@h.com", pw, 161);
  const admin = await loginAs("admin@hnetmedia.com", "un mot de passe solide 2026", 162);

  const used = (await upload(contrib, fakeImage("png", 500, 500))).json.media;
  const free = (await upload(contrib, fakeImage("png", 400, 400))).json.media;
  const art = (await as(contrib, "POST", "/api/admin/articles", { title: "Avec image", category: "culture" })).json.article;
  assert.equal((await as(contrib, "PUT", `/api/admin/articles/${art.id}`, { mainImage: { url: used.url, alt: "Vue" } })).status, 200);

  const list = (await as(contrib, "GET", "/api/admin/media")).json.items;
  assert.equal(list.find((x) => x.id === used.id).usage, 1, "usage compté (image principale)");
  assert.equal(list.find((x) => x.id === free.id).usage, 0);

  assert.equal((await as(contrib, "DELETE", `/api/admin/media/${used.id}`)).status, 409, "image utilisée : refus");
  assert.equal((await getMedia(used.id)).status, 200, "toujours servie");
  assert.equal((await as(editeur, "DELETE", `/api/admin/media/${free.id}`)).status, 200, "l'éditeur (media.manage) supprime n'importe quelle image libre");
  assert.equal((await getMedia(free.id)).status, 404, "image supprimée = introuvable");
  assert.equal((await as(admin, "DELETE", `/api/admin/media/${free.id}`)).status, 404, "déjà supprimée");
  assert.equal((await as(admin, "DELETE", "/api/admin/media/pas-un-uuid")).status, 404);

  const mine = (await upload(contrib, fakeImage("png", 300, 300))).json.media;
  const other = (await upload(admin, fakeImage("png", 300, 310))).json.media;
  assert.equal((await as(contrib, "DELETE", `/api/admin/media/${other.id}`)).status, 403, "un contributeur ne supprime que les siennes");
  assert.equal((await as(contrib, "DELETE", `/api/admin/media/${mine.id}`)).status, 200);

  // image dans le texte d'un article (pas seulement en image principale)
  const inText = (await upload(admin, fakeImage("png", 320, 320))).json.media;
  const art2 = (await as(admin, "POST", "/api/admin/articles", { title: "Image dans le texte", category: "culture" })).json.article;
  await as(admin, "PUT", `/api/admin/articles/${art2.id}`, { translations: { fr: { title: "Image dans le texte", content: `<figure><img src="${inText.url}" alt="x"></figure>` } } });
  assert.equal((await as(admin, "DELETE", `/api/admin/media/${inText.id}`)).status, 409, "image présente dans le texte : refus");
  assert.ok((await db().query("SELECT 1 FROM audit_log WHERE action = 'media.suppression'")).length >= 2, "suppressions journalisées");
});

test("équipe, partenaires, offres, réglages : droits, validation, rendu public", async () => {
  const pw = "mot de passe de test 2026";
  const admin = await loginAs("admin@hnetmedia.com", "un mot de passe solide 2026", 170);
  const com = await loginAs("com@h.com", pw, 171);
  const chef = await loginAs("chef@hnetmedia.com", "mot de passe du chef 2026", 172);
  const journa = await loginAs("journa@h.com", pw, 173);

  // droits : commercial = partenaires ; rédacteur en chef = équipe + offres ; réglages = administrateur seul
  assert.equal((await as(journa, "GET", "/api/admin/partners")).status, 403);
  assert.equal((await as(com, "GET", "/api/admin/partners")).status, 200);
  assert.equal((await as(com, "GET", "/api/admin/jobs")).status, 403);
  assert.equal((await as(chef, "GET", "/api/admin/jobs")).status, 200);
  assert.equal((await as(chef, "GET", "/api/admin/team")).status, 200);
  assert.equal((await as(com, "GET", "/api/admin/team")).status, 403);
  assert.equal((await as(chef, "GET", "/api/admin/settings")).status, 403);
  assert.equal((await as(admin, "GET", "/api/admin/settings")).status, 200);
  assert.equal((await call("POST", "/api/admin/partners", { body: { name: "X" } })).status, 401);

  // partenaires : https obligatoire, pas de faux contenu
  assert.equal((await as(com, "POST", "/api/admin/partners", { name: "Sans lien", url: "http://non-https.example" })).status, 400);
  assert.equal((await as(com, "POST", "/api/admin/partners", { name: "Piège", url: "javascript:alert(1)" })).status, 400);
  assert.equal((await as(com, "POST", "/api/admin/partners", { name: "" })).status, 400);
  let r = await as(com, "POST", "/api/admin/partners", { name: "Partenaire <b>Réel</b> & Cie", url: "https://partenaire.example/", description: "Soutien $& test", kind: "partenaire" });
  assert.equal(r.status, 201, r.text);
  const pid = r.json.id;
  const hidden = (await as(com, "POST", "/api/admin/partners", { name: "Inactif", active: false })).json.id;

  // offres : « ouvert » exige un moyen de postuler
  assert.equal((await as(chef, "POST", "/api/admin/jobs", { title: "Reporter", description: "Texte", status: "ouvert" })).status, 400);
  r = await as(chef, "POST", "/api/admin/jobs", { title: "Reporter terrain", description: "Couvrir l'actualité.\nSecond $1 paragraphe.", contract: "CDD", location: "Pétion-Ville", status: "ouvert", applyEmail: "recrutement@exemple.test" });
  assert.equal(r.status, 201, r.text);
  const jid = r.json.id;
  const brouillon = (await as(chef, "POST", "/api/admin/jobs", { title: "Brouillon", description: "X" })).json.id;

  // équipe : fiche, lien https, suppression bloquée si signataire
  assert.equal((await as(chef, "POST", "/api/admin/team", { name: "Mauvais", social: { twitter: "http://x.example" } })).status, 400);
  r = await as(chef, "POST", "/api/admin/team", { name: "Marie Éclair", role: "Reporter", bio: "Bio réelle.", social: { twitter: "https://x.com/marie" } });
  assert.equal(r.status, 201, r.text);
  const aid = r.json.id;
  assert.match(aid, /^marie-eclair/);
  const art = (await as(admin, "POST", "/api/admin/articles", { title: "Signé", category: "culture" })).json.article;
  await db().query("UPDATE articles SET author_id = $1 WHERE id = $2", [aid, art.id]);
  assert.equal((await as(chef, "DELETE", `/api/admin/team/${aid}`)).status, 409, "signataire d'un article : suppression refusée");

  // réglages : validation
  const cur = (await as(admin, "GET", "/api/admin/settings")).json.settings;
  const save = (patch) => as(admin, "PUT", "/api/admin/settings", { ...cur, ...patch });
  assert.equal((await save({ siteName: "" })).status, 400);
  assert.equal((await save({ social: { facebook: "http://pas-https.example" } })).status, 400);
  assert.equal((await save({ contactCategories: [] })).status, 400);
  assert.equal((await save({ contactCategories: ["Autre", "autre"] })).status, 400, "doublon refusé");
  r = await save({ social: { facebook: "https://facebook.com/hnetmedia" }, legal: { director: "J. Roosvelt Jean Charles", hostName: "Vercel Inc.", hostAddress: "340 S Lemon Ave, Walnut, CA", registration: "" }, contactCategories: ["Rédaction", "Droit de réponse", "Autre"] });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.settings.social.facebook, "https://facebook.com/hnetmedia");
  assert.deepEqual((await db().query("SELECT value FROM site_settings WHERE key = 'contactCategories'"))[0].value, ["Rédaction", "Droit de réponse", "Autre"]);
  assert.equal((await call("POST", "/api/contact", { body: { name: "Lecteur", email: "l@x.test", category: "Publicité", subject: "Sujet de test", message: "Message de test assez long pour passer.", hp: "", ts: formTs() }, headers: ip(171) })).status, 400, "type retiré des réglages = refusé par le contact");

  // rendu public : seul le réel apparaît, rien d'inactif ni de brouillon
  const out = require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "hn-cat-"));
  execFileSync("node", ["build.js"], { cwd: require("node:path").join(__dirname, ".."), env: { ...process.env, BUILD_OUT: out }, stdio: "pipe" });
  const rd = (f) => require("node:fs").readFileSync(require("node:path").join(out, f), "utf8");
  const part = rd("partenaires.html");
  assert.ok(part.includes("Partenaire Réel &amp; Cie") && !part.includes("<b>Réel"), "balises retirées, « & » échappé à l'affichage");
  assert.ok(part.includes("Soutien $&amp; test"), "le « $& » du texte n'est pas interprété par le remplacement");
  assert.ok(!part.includes("Inactif"), "partenaire inactif absent");
  const car = rd("carrieres.html");
  assert.ok(car.includes("Reporter terrain") && car.includes("mailto:recrutement@exemple.test") && car.includes("Second $1 paragraphe"), "offre ouverte avec description et moyen de postuler");
  assert.ok(!car.includes(">Brouillon<"), "offre en brouillon absente");
  const foot = rd("index.html");
  assert.ok(foot.includes('href="https://facebook.com/hnetmedia"') && !foot.includes('class="soc-btn" href="#"'), "réseau renseigné affiché, aucun lien « # »");
  assert.ok(!foot.includes("aria-label=\"LinkedIn\""), "réseau non renseigné absent");
  const leg = rd("mentions-legales.html");
  assert.ok(leg.includes("J. Roosvelt Jean Charles") && leg.includes("Vercel Inc.") && leg.includes("numéro d'immatriculation") && leg.includes("dev-notice"), "mentions : valeurs réelles + avis seulement pour ce qui manque");
  assert.ok(!leg.includes("directeur de la publication, ") && !/il manque [^<]*hébergeur/.test(leg), "avis ne réclame plus ce qui est renseigné");
  assert.ok(rd("equipe.html").includes("Marie Éclair"), "fiche d'équipe publiée");

  // suppressions
  assert.equal((await as(com, "DELETE", `/api/admin/partners/${pid}`)).status, 200);
  assert.equal((await as(com, "DELETE", `/api/admin/partners/${pid}`)).status, 404);
  assert.equal((await as(chef, "DELETE", `/api/admin/jobs/${jid}`)).status, 200);
  await db().query("UPDATE articles SET author_id = NULL WHERE id = $1", [art.id]);
  assert.equal((await as(chef, "DELETE", `/api/admin/team/${aid}`)).status, 200, "fiche libre : supprimée");
  assert.ok(hidden && brouillon);
  assert.ok((await db().query("SELECT 1 FROM audit_log WHERE action IN ('partenaire.creation','offre.creation','equipe.creation','reglages.modification')")).length >= 4, "actions journalisées");
});

/* ═════════════════════════ TABLEAU DE BORD : vues, plus lus ═════════════════════════ */
test("tableau de bord : chiffres réels, plus lus par article / rédacteur / rubrique / mot-clé, droits", async () => {
  const pw = "mot de passe de test 2026";
  await db().query("DELETE FROM rate_limits WHERE key LIKE 'login:email:%'"); // les tests précédents ont déjà beaucoup connecté l'administrateur
  const admin = await loginAs("admin@hnetmedia.com", "un mot de passe solide 2026", 180);
  const contrib = await loginAs("contrib@h.com", pw, 181);
  const journa = await loginAs("journa@h.com", pw, 182);
  assert.equal((await call("GET", "/api/admin/stats/overview")).status, 401);
  assert.equal((await as(contrib, "GET", "/api/admin/stats/overview")).status, 403, "contributeur : pas de statistiques");

  const q = (t, p) => db().query(t, p);
  await q("DELETE FROM page_views"); // repart d'un compteur vide (les tests précédents ont compté quelques vues)
  await q("INSERT INTO authors (id, name) VALUES ('ov-marie', 'Marie Lecture') ON CONFLICT DO NOTHING");
  await q("INSERT INTO tags (slug, label) VALUES ('ov-tag', 'Tag Lu') ON CONFLICT DO NOTHING");
  const mk = async (id, cat, authorId, authorName) => {
    await q(`INSERT INTO articles (id, slug, status, category_slug, author_id, author_name, published_at) VALUES ($1, $1, 'publie', $2, $3, $4, now() - interval '2 days')`, [id, cat, authorId, authorName]);
    await q(`INSERT INTO article_translations (article_id, lang, title, excerpt, content, reviewed) VALUES ($1, 'fr', $2, 'c', '<p>t</p>', true)`, [id, "Titre " + id]);
  };
  await mk("ov-a", "culture", "ov-marie", null); await mk("ov-b", "culture", "ov-marie", null); await mk("ov-c", "sport", null, "Signature Libre");
  await q("INSERT INTO article_tags (article_id, tag_slug) VALUES ('ov-a', 'ov-tag'), ('ov-c', 'ov-tag')");
  const pv = (path, art, hours, views) => q("INSERT INTO page_views (path, bucket, article_id, views) VALUES ($1, date_trunc('hour', now() - ($2 || ' hours')::interval), $3, $4)", [path, String(hours), art, views]);
  await pv("/article/ov-a", "ov-a", 3, 50); await pv("/article/ov-b", "ov-b", 5, 10); await pv("/article/ov-c", "ov-c", 7, 30);
  await pv("/article/ov-a", "ov-a", 24 * 40, 20); // période précédente (40 jours), hors des 30 derniers jours

  let r = await as(admin, "GET", "/api/admin/stats/overview?days=30");
  assert.equal(r.status, 200, r.text);
  const o = r.json;
  assert.deepEqual(o.views, { cur: 90, prev: 20 }, "vues de la période et de la précédente");
  assert.equal(o.perDay.length, 30, "un point par jour, jours vides inclus");
  assert.equal(o.perDay.reduce((a, d) => a + d.views, 0), 90);
  assert.deepEqual(o.topArticles.slice(0, 3).map((x) => [x.slug, x.views]), [["ov-a", 50], ["ov-c", 30], ["ov-b", 10]]);
  assert.deepEqual(o.topAuthors.slice(0, 2).map((x) => [x.name, x.views, x.articles]), [["Marie Lecture", 60, 2], ["Signature Libre", 30, 1]], "rédacteurs : fiche ou signature libre");
  assert.deepEqual(o.topCategories.slice(0, 2).map((x) => [x.slug, x.views]), [["culture", 60], ["sport", 30]]);
  assert.deepEqual(o.topTags.map((x) => [x.label, x.views]), [["Tag Lu", 80]]);
  assert.ok(o.articles.publie >= 3 && o.scope === "all" && Array.isArray(o.activity), "compteurs, portée, activité (administrateur)");
  assert.ok(typeof o.messagesNew === "number" && typeof o.subscribers === "number" && typeof o.jobsOpen === "number", "sections réservées aux droits");

  assert.equal((await as(admin, "GET", "/api/admin/stats/overview?days=7")).json.views.cur, 90, "7 jours : mêmes vues récentes");
  assert.equal((await as(admin, "GET", "/api/admin/stats/overview?days=999")).json.days, 30, "période inconnue : 30 jours");
  assert.equal((await as(admin, "GET", "/api/admin/stats/overview?days=90")).json.views.prev, 0, "90 jours : rien avant");

  const j = (await as(journa, "GET", "/api/admin/stats/overview")).json;
  assert.equal(j.scope, "own", "journaliste : compteurs d'articles limités à ses propres articles");
  assert.ok(j.activity === undefined && j.messagesNew === undefined && j.subscribers === undefined, "pas d'activité, ni messages, ni abonnés pour un journaliste");
  assert.ok(!JSON.stringify(o).includes("@"), "aucune adresse e-mail dans la réponse");
});

/* ═════════════════════════ PAGES FIXES MODIFIABLES + PIED DE PAGE ═════════════════════════ */
test("pages fixes : droits, nettoyage du HTML, rendu public, retour au texte d'origine, pied de page", async () => {
  await db().query("DELETE FROM rate_limits WHERE key LIKE 'login:email:%'");
  const admin = await loginAs("admin@hnetmedia.com", "un mot de passe solide 2026", 190);
  const chef = await loginAs("chef@hnetmedia.com", "mot de passe du chef 2026", 191);
  assert.equal((await call("GET", "/api/admin/pages")).status, 401);
  assert.equal((await as(chef, "GET", "/api/admin/pages")).status, 403, "réservé à l'administrateur (settings.manage)");

  let r = await as(admin, "GET", "/api/admin/pages");
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.items.map((p) => p.slug), ["a-propos", "charte-editoriale", "publicite", "cgu", "confidentialite", "cookies"]);
  assert.ok(r.json.items.every((p) => p.versions.fr.custom === false && p.versions.en.custom === false), "aucune page modifiée au départ (ni en français ni en anglais)");
  assert.equal(r.json.items[0].versions.en.title, "Who we are", "titre anglais d'origine");
  r = await as(admin, "GET", "/api/admin/pages/a-propos");
  assert.equal(r.json.page.content, null, "texte d'origine : pas de contenu en base");
  assert.equal((await as(admin, "GET", "/api/admin/pages/a-propos?lang=en")).json.page.title, "Who we are");
  assert.equal((await as(admin, "GET", "/api/admin/pages/a-propos?lang=ht")).status, 400, "seules les langues fr et en existent");
  assert.equal((await as(admin, "GET", "/api/admin/pages/mentions-legales")).status, 404, "seules les pages prévues sont modifiables");
  assert.equal((await as(admin, "GET", "/api/admin/pages/..%2Fetc")).status, 404);

  const mal = `<h2>Notre mission $& vraie</h2><p>Un texte réel assez long pour passer. <script>alert(1)</script><img src="x" onerror="alert(2)"><a href="javascript:alert(3)">piège</a> <a href="/contact">Contact</a></p><iframe src="https://evil.example"></iframe>`;
  assert.equal((await as(admin, "PUT", "/api/admin/pages/a-propos", { title: "ab", content: mal })).status, 400, "titre trop court");
  assert.equal((await as(admin, "PUT", "/api/admin/pages/a-propos", { title: "Qui nous sommes", content: "<p>court</p>" })).status, 400, "texte trop court");
  assert.equal((await as(admin, "PUT", "/api/admin/pages/inconnue", { title: "Titre valide", content: mal })).status, 404);
  r = await as(admin, "PUT", "/api/admin/pages/a-propos", { title: "<b>Qui</b> sommes-nous & pourquoi", description: "Description <i>réelle</i>", content: mal });
  assert.equal(r.status, 200, r.text);
  const saved = r.json.page;
  assert.equal(saved.title, "Qui sommes-nous & pourquoi", "titre en texte brut");
  assert.ok(!/<script|onerror|javascript:|<iframe|evil\.example/i.test(saved.content), "script, gestionnaires, javascript: et iframe retirés : " + saved.content);
  assert.ok(saved.content.includes('href="/contact"') && saved.content.includes("Notre mission $&amp; vraie") || saved.content.includes("Notre mission $& vraie"), "contenu légitime conservé");
  assert.equal(saved.custom, true);

  // rendu public
  const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
  const buildTo = () => { const out = fs.mkdtempSync(path.join(os.tmpdir(), "hn-pg-")); execFileSync("node", ["build.js"], { cwd: ROOT, env: { ...process.env, BUILD_OUT: out, I18N_STRICT: "1" }, stdio: "pipe" }); return (f) => fs.readFileSync(path.join(out, f), "utf8"); };
  let rd = buildTo();
  let page = rd("a-propos.html");
  assert.ok(page.includes("<h1>Qui sommes-nous &amp; pourquoi</h1>") && page.includes("Notre mission $"), "page modifiée publiée, titre échappé, « $ » intact");
  assert.ok(!/alert\(|evil\.example|onerror/i.test(page), "rien de dangereux dans la page publiée");
  assert.ok(page.includes('content="Description réelle"') || page.includes("Description réelle"), "description pour les moteurs de recherche");
  assert.ok(!rd("charte-editoriale.html").includes("Qui sommes-nous &amp; pourquoi") && rd("charte-editoriale.html").includes("Charte éditoriale"), "les autres pages gardent leur texte d'origine");

  // version anglaise de la même page : indépendante de la française
  r = await as(admin, "PUT", "/api/admin/pages/a-propos?lang=en", { title: "About <b>us</b>", description: "English description", content: "<h2>Our mission</h2><p>An English text long enough to be saved as the page.</p><script>alert(1)</script>" });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.page.lang, "en");
  rd = buildTo();
  assert.ok(rd("en/a-propos.html").includes("<h1>About us</h1>") && rd("en/a-propos.html").includes('<html lang="en">') && !rd("en/a-propos.html").includes("alert(1)"), "page anglaise modifiée publiée sous /en, nettoyée");
  assert.ok(rd("a-propos.html").includes("Qui sommes-nous &amp; pourquoi"), "la version française reste intacte");
  assert.equal((await as(admin, "DELETE", "/api/admin/pages/a-propos?lang=en")).status, 200);
  assert.ok(buildTo()("en/a-propos.html").includes("Who we are"), "texte d'origine anglais rétabli");

  // retour au texte d'origine
  assert.equal((await as(admin, "DELETE", "/api/admin/pages/a-propos")).status, 200);
  assert.equal((await as(admin, "DELETE", "/api/admin/pages/a-propos")).status, 404, "déjà rétablie");
  assert.ok(buildTo()("a-propos.html").includes("Notre mission"), "texte d'origine revenu");

  // pied de page modifiable (texte brut, échappé) ; vide = texte d'origine
  const cur = (await as(admin, "GET", "/api/admin/settings")).json.settings;
  r = await as(admin, "PUT", "/api/admin/settings", { ...cur, footerText: "Votre média <b>indépendant</b> & libre." });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.settings.footerText, "Votre média indépendant & libre.");
  assert.ok(buildTo()("index.html").includes('<p class="ft-desc">Votre média indépendant &amp; libre.</p>'), "pied de page personnalisé, échappé");
  assert.ok(buildTo()("en/index.html").includes("Your reference source of information"), "pied de page anglais : traduction d'origine tant qu'aucune version anglaise n'est saisie");
  r = await as(admin, "PUT", "/api/admin/settings", { ...cur, footerText: "" });
  assert.equal(r.json.settings.footerText, "");
  assert.ok(buildTo()("index.html").includes("Un journalisme indépendant, rigoureux"), "texte d'origine du pied de page rétabli");
  assert.ok((await db().query("SELECT 1 FROM audit_log WHERE action IN ('page.modification','page.retablie')")).length >= 2, "actions journalisées");
});

/* ═════════════════════════ VERSION ANGLAISE, RUBRIQUES, IMAGES INUTILISÉES ═════════════════════════ */
test("version anglaise : traductions relues seulement, liens et langue, aucune phrase française, pas de créole", async () => {
  await db().query("DELETE FROM rate_limits WHERE key LIKE 'login:email:%'");
  const admin = await loginAs("admin@hnetmedia.com", "un mot de passe solide 2026", 200);
  const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
  const q = (t, p) => db().query(t, p);
  const mk = async (id, cat, extra = "") => {
    await q(`INSERT INTO articles (id, slug, status, category_slug, author_name, published_at, original_lang) VALUES ($1, $1, 'publie', $2, 'Signature', now() - interval '1 day', 'fr')`, [id, cat]);
    await q(`INSERT INTO article_translations (article_id, lang, title, excerpt, content, reviewed) VALUES ($1, 'fr', $2, 'Chapeau français', '<p>Texte français.</p>', true)`, [id, "Titre FR " + id]);
  };
  await mk("en-ok", "culture"); await mk("en-nonrelu", "culture"); await mk("en-sans", "culture"); await mk("en-ht", "culture");
  await q(`INSERT INTO article_translations (article_id, lang, title, excerpt, content, reviewed) VALUES ('en-ok', 'en', 'English title ok', 'English summary', '<p>English text.</p>', true), ('en-nonrelu', 'en', 'English NOT reviewed', 'x', '<p>pas relu</p>', false)`);
  await q("INSERT INTO article_translations (article_id, lang, title, excerpt, content, reviewed) VALUES ('en-ht', 'ht', 'Tit kreyòl', 'x', '<p>kreyòl</p>', true)"); // aucune interface ne le propose plus ; ne doit jamais sortir
  // créole refusé par l'API d'édition
  const art = (await as(admin, "POST", "/api/admin/articles", { title: "Test langue", category: "culture" })).json.article;
  assert.equal((await as(admin, "PUT", `/api/admin/articles/${art.id}`, { translations: { ht: { title: "Tit", content: "<p>x</p>" } } })).status, 400, "le créole n'est plus accepté");

  const out = fs.mkdtempSync(path.join(os.tmpdir(), "hn-en-"));
  execFileSync("node", ["build.js"], { cwd: ROOT, env: { ...process.env, BUILD_OUT: out, I18N_STRICT: "1" }, stdio: "pipe" }); // échoue si une phrase n'a pas de traduction
  const rd = (f) => fs.readFileSync(path.join(out, f), "utf8"), has = (f) => fs.existsSync(path.join(out, f));

  assert.ok(has("en/article/en-ok.html") && !has("en/article/en-nonrelu.html") && !has("en/article/en-sans.html") && !has("en/article/en-ht.html"), "anglais : seulement les traductions relues et validées");
  assert.ok(has("article/en-nonrelu.html") && has("article/en-sans.html"), "le français garde tous ses articles");
  const en = rd("en/article/en-ok.html");
  assert.ok(/<html lang="en">/.test(en) && en.includes("English title ok") && en.includes("English text.") && !en.includes("Titre FR"), "texte anglais, jamais le français");
  assert.ok(!/NOT reviewed|pas relu|kreyòl|Tit kreyòl/.test(rd("en/index.html") + rd("en/culture.html")), "rien de non relu sur l'accueil ni la rubrique");
  const idx = JSON.parse(rd("en/content/search-index.json"));
  assert.ok(idx.some((x) => x.slug === "en-ok") && !idx.some((x) => /^en-(nonrelu|sans|ht)$/.test(x.slug)), "index de recherche anglais : seulement ce qui est publié en anglais");
  assert.ok(JSON.parse(rd("content/search-index.json")).length >= 4, "index français complet");

  // liens, canonical, équivalents de langue
  assert.ok(en.includes('href="/en/culture"') && en.includes('href="/en/contact"') && !en.includes('href="/culture"'), "liens internes préfixés par /en");
  assert.ok(en.includes('<link rel="canonical" href="https://www.hnetmedia.com/en/article/en-ok">'), "canonical propre, sans .html : " + (en.match(/rel="canonical"[^>]*/) || [""])[0]);
  assert.ok(en.includes('hreflang="fr" href="https://www.hnetmedia.com/article/en-ok"') && en.includes('hreflang="en" href="https://www.hnetmedia.com/en/article/en-ok"'), "hreflang fr/en");
  assert.ok(en.includes('<a class="lang-btn" href="/article/en-ok" hreflang="fr"') && en.includes('<a class="lang-btn active" href="/en/article/en-ok" hreflang="en"'), "sélecteur de langue : vrai lien vers la même page");
  const frOnly = rd("article/en-sans.html");
  assert.ok(frOnly.includes('<a class="lang-btn" href="/en" hreflang="en"') && !frOnly.includes('hreflang="x-default"'), "article sans version anglaise : le sélecteur renvoie à l'accueil anglais, pas d'hreflang trompeur");
  assert.ok(rd("index.html").includes('href="/culture"') && !rd("index.html").includes(".html\""), "français : liens propres, sans .html");
  assert.ok(rd("sitemap.xml").includes("<loc>https://www.hnetmedia.com/en/article/en-ok</loc>") && rd("sitemap.xml").includes("<loc>https://www.hnetmedia.com/article/en-sans</loc>") && !rd("sitemap.xml").includes("/en/article/en-sans") && !rd("sitemap.xml").includes(".html"), "plan du site : anglais seulement pour ce qui existe, URLs propres");
  assert.ok(rd("en/rss.xml").includes("English title ok") && !rd("en/rss.xml").includes("Titre FR") && rd("en/rss.xml").includes("<language>en-gb</language>"), "flux RSS anglais");

  // aucune phrase française dans l'interface anglaise (hors contenu saisi : articles, noms)
  for (const f of ["en/index.html", "en/culture.html", "en/a-propos.html", "en/contact.html", "en/recherche.html", "en/plan-du-site.html", "en/404.html", "en/cookies.html", "en/confidentialite.html", "en/mentions-legales.html", "en/carrieres.html", "en/equipe.html", "en/partenaires.html", "en/publicite.html", "en/cgu.html", "en/charte-editoriale.html"]) {
    const text = rd(f).replace(/<head>[\s\S]*?<\/head>/, "").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");
    const clean = text.replace(/La rédaction|Signature|Titre FR[^ ]*|Chapeau français|Texte français/g, "");
    const bad = clean.match(/.{0,30}(\b(pour|dans|votre|vous|nos|notre|des|les|cette|sont|avec)\b|[éèêàçùô]).{0,30}/);
    assert.ok(!bad, `texte français dans ${f} : « ${bad && bad[0]} »`);
  }
  assert.ok(rd("en/contact.html").includes('<option value="Rédaction">Newsroom</option>'), "formulaire de contact : texte anglais, valeur d'origine envoyée au serveur");
  assert.ok(rd("en/index.html").includes("Politics") && rd("en/index.html").includes("World"), "rubriques en anglais");
});

test("rubriques : libellés FR/EN modifiables, droits, ordre dans le menu ; images inutilisées nettoyées", async () => {
  await db().query("DELETE FROM rate_limits WHERE key LIKE 'login:email:%'");
  const admin = await loginAs("admin@hnetmedia.com", "un mot de passe solide 2026", 210);
  const journa = await loginAs("journa@h.com", "mot de passe de test 2026", 211);
  const editeur = await loginAs("editeur@h.com", "mot de passe de test 2026", 212);
  assert.equal((await call("GET", "/api/admin/categories")).status, 401);
  assert.equal((await as(journa, "GET", "/api/admin/categories")).status, 403, "réservé à la gestion des rubriques");
  let r = await as(editeur, "GET", "/api/admin/categories");
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.items.find((c) => c.slug === "monde").labelEn, "World", "libellés anglais d'origine");
  assert.equal((await as(editeur, "PUT", "/api/admin/categories/monde", { label: "", labelEn: "World" })).status, 400);
  assert.equal((await as(editeur, "PUT", "/api/admin/categories/monde", { label: "Monde", position: "500" })).status, 400);
  assert.equal((await as(editeur, "PUT", "/api/admin/categories/inconnue", { label: "Nom valide" })).status, 404);
  r = await as(editeur, "PUT", "/api/admin/categories/sport", { label: "Sports <b>locaux</b>", labelEn: "Local sport", description: "Description française.", descriptionEn: "English description.", position: 99 });
  assert.equal(r.status, 200, r.text);
  const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "hn-cat-"));
  execFileSync("node", ["build.js"], { cwd: ROOT, env: { ...process.env, BUILD_OUT: out, I18N_STRICT: "1" }, stdio: "pipe" });
  const home = fs.readFileSync(path.join(out, "index.html"), "utf8"), homeEn = fs.readFileSync(path.join(out, "en/index.html"), "utf8");
  assert.ok(home.includes(">Sports locaux<") && !home.includes("<b>locaux"), "menu français : nom modifié, balises retirées");
  assert.ok(homeEn.includes(">Local sport<"), "menu anglais : nom anglais");
  assert.ok(home.indexOf('data-route="sport"') > home.indexOf('data-route="opinions"'), "ordre du menu suivi (sport passé en dernier)");
  assert.ok(fs.readFileSync(path.join(out, "en/sport.html"), "utf8").includes("English description."), "description anglaise sur la page de la rubrique");
  await as(editeur, "PUT", "/api/admin/categories/sport", { label: "Sport", labelEn: "Sport", description: "Résultats, compétitions, transferts et portraits d'athlètes.", descriptionEn: "Results, competitions, transfers and athlete profiles.", position: 3 });

  // nettoyage des images inutilisées : seulement > 24 h, jamais celles qui servent
  const png = fakeImage("png", 200, 200);
  const old = (await upload(admin, png)).json.media, usedOld = (await upload(admin, fakeImage("png", 210, 210))).json.media, fresh = (await upload(admin, fakeImage("png", 220, 220))).json.media;
  await db().query("UPDATE media SET created_at = now() - interval '3 days' WHERE id IN ($1, $2)", [old.id, usedOld.id]);
  const art = (await as(admin, "POST", "/api/admin/articles", { title: "Image utile", category: "culture" })).json.article;
  assert.equal((await as(admin, "PUT", `/api/admin/articles/${art.id}`, { mainImage: { url: usedOld.url, alt: "Utile" } })).status, 200);
  assert.equal((await as(journa, "POST", "/api/admin/media/cleanup")).status, 403, "réservé à la gestion de la médiathèque");
  r = await as(editeur, "GET", "/api/admin/media/unused");
  assert.equal(r.json.count >= 1, true);
  const before = r.json.count;
  r = await as(editeur, "POST", "/api/admin/media/cleanup");
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.deleted, before, "toutes les images inutilisées de plus de 24 h supprimées");
  assert.equal((await getMedia(old.id)).status, 404, "image inutilisée ancienne supprimée");
  assert.equal((await getMedia(usedOld.id)).status, 200, "image utilisée conservée même ancienne");
  assert.equal((await getMedia(fresh.id)).status, 200, "image récente conservée");
  assert.equal((await as(editeur, "GET", "/api/admin/media/unused")).json.count, 0);
  assert.ok((await db().query("SELECT 1 FROM audit_log WHERE action = 'media.nettoyage'")).length === 1, "nettoyage journalisé");
});

/* ═════════════════════════ NOTIFICATIONS PUSH (appli Android) ═════════════════════════ */
test("push : appareils, déclencheurs, rappels sans doublon, jamais bloquant", async () => {
  process.env.FCM_TEST_SINK = "1";
  global.__pushSent = [];
  const admin = await loginAs("admin@hnetmedia.com", "un mot de passe solide 2026", 200);
  const T1 = "token-appareil-de-test-0123456789-abcdef";
  const sentTo = () => global.__pushSent.filter((x) => x.token === T1);

  // enregistrement du jeton : session + CSRF + jeton valide, sans doublon
  assert.equal((await call("POST", "/api/admin/devices", { body: { token: T1 } })).status, 401, "sans session");
  assert.equal((await call("POST", "/api/admin/devices", { body: { token: T1 }, cookie: admin.cookie })).status, 403, "sans CSRF");
  assert.equal((await as(admin, "POST", "/api/admin/devices", { token: "court" })).status, 400, "jeton trop court");
  assert.equal((await as(admin, "POST", "/api/admin/devices", { token: T1 })).status, 200);
  assert.equal((await as(admin, "POST", "/api/admin/devices", { token: T1 })).status, 200);
  assert.equal((await db().query("SELECT count(*)::int n FROM device_tokens"))[0].n, 1, "un seul enregistrement par jeton");

  // nouveau message de contact → notification (sans le texte du message)
  const ok = { name: "Paul Louis", email: "paul@example.org", category: "Rédaction", subject: "Info push", message: "Texte secret du message de test.", hp: "", ts: formTs() };
  assert.equal((await call("POST", "/api/contact", { body: ok, headers: ip(250) })).status, 200);
  let n = sentTo();
  assert.equal(n.length, 1);
  assert.equal(n[0].data.channel, "messages");
  assert.ok(n[0].data.title.includes("message") && n[0].data.body.includes("Paul Louis"));
  assert.ok(!JSON.stringify(n[0].data).includes("secret"), "le contenu du message n'est jamais envoyé à Firebase");
  assert.equal(n[0].data.url, "/admin#/messages");

  // publication manuelle → notification « publication »
  const art = (await as(admin, "POST", "/api/admin/articles", { title: "Article push", category: "culture" })).json.article;
  assert.equal((await as(admin, "PUT", `/api/admin/articles/${art.id}`, { translations: { fr: { title: "Article push", content: "<p>Texte complet.</p>" } }, authorName: "Rédaction" })).status, 200);
  const before = sentTo().length;
  await giveImage(art.id);
  assert.equal((await as(admin, "POST", `/api/admin/articles/${art.id}/status`, { status: "publie" })).status, 200);
  const pub = sentTo().slice(before);
  assert.equal(pub.length, 1);
  assert.equal(pub[0].data.channel, "publication");
  assert.ok(pub[0].data.url.startsWith("/admin#/articles/"), "lien vers l'admin : la page publique n'existe qu'après la reconstruction du site");

  // rappels : un seul par message dans la fenêtre, 3 au maximum
  await db().query("UPDATE contact_messages SET status = 'traite'");
  await db().query(`INSERT INTO contact_messages (name, email, category, message, status, created_at)
                    VALUES ('Ancien', 'a@example.org', 'Rédaction', 'Message ancien non traité', 'nouveau', now() - interval '1 hour')`);
  const { remindPending } = require("../server/scheduled");
  const c0 = sentTo().length;
  assert.equal(await remindPending(), 1);
  assert.equal(sentTo().length, c0 + 1);
  assert.equal(await remindPending(), 0, "pas de doublon tout de suite");
  await db().query("UPDATE contact_messages SET push_reminded_at = now() - interval '3 hours' WHERE name = 'Ancien'");
  assert.equal(await remindPending(), 1, "2e rappel après 2 h");
  await db().query("UPDATE contact_messages SET push_reminded_at = now() - interval '3 hours', push_reminders = 3 WHERE name = 'Ancien'");
  assert.equal(await remindPending(), 0, "3 rappels maximum");

  // suppression du jeton à la déconnexion
  assert.equal((await as(admin, "DELETE", "/api/admin/devices", { token: T1 })).status, 200);
  assert.equal((await db().query("SELECT count(*)::int n FROM device_tokens"))[0].n, 0);

  // sans configuration push : le formulaire de contact fonctionne toujours et les rappels ne consomment rien
  delete process.env.FCM_TEST_SINK;
  await db().query("INSERT INTO device_tokens (user_id, token) SELECT id, $1 FROM users LIMIT 1", [T1]);
  const c1 = sentTo().length;
  assert.equal((await call("POST", "/api/contact", { body: ok, headers: ip(251) })).status, 200);
  assert.equal(sentTo().length, c1, "rien envoyé sans clé Firebase");
  await db().query("UPDATE contact_messages SET status='nouveau', push_reminders = 0, push_reminded_at = NULL, created_at = now() - interval '2 hours' WHERE name = 'Ancien'");
  assert.equal(await remindPending(), 0);
  assert.equal((await db().query("SELECT push_reminders FROM contact_messages WHERE name = 'Ancien'"))[0].push_reminders, 0, "compteur de rappels intact");
});

/* ═════════════════════════ ARTICLES À APPROUVER + COMMENTAIRES (push) ═════════════════════════ */
test("push : article à approuver, rappel unique, commentaires prêts mais non branchés", async () => {
  process.env.FCM_TEST_SINK = "1";
  global.__pushSent = [];
  const admin = await loginAs("admin@hnetmedia.com", "un mot de passe solide 2026", 210);
  const TA = "token-approbateur-0123456789-abcdefghij";
  assert.equal((await as(admin, "POST", "/api/admin/devices", { token: TA })).status, 200);
  const mine = () => global.__pushSent.filter((x) => x.token === TA);

  // un journaliste (sans droit de publier) soumet un brouillon complet
  const pw = "un mot de passe solide 2026";
  assert.equal((await as(admin, "POST", "/api/admin/users", { email: "jr@hnetmedia.com", name: "Jean Reporter", role: "journaliste", password: pw })).status, 201);
  const jr = await loginAs("jr@hnetmedia.com", pw, 211);
  const art = (await as(jr, "POST", "/api/admin/articles", { title: "Reportage à valider", category: "culture" })).json.article;
  assert.equal((await as(jr, "POST", `/api/admin/articles/${art.id}/review`, {})).status, 400, "contenu obligatoire avant de soumettre");
  assert.equal((await as(jr, "PUT", `/api/admin/articles/${art.id}`, { translations: { fr: { title: "Reportage à valider", content: "<p>Texte du reportage.</p>" } }, authorName: "Jean Reporter" })).status, 200);
  const noImg = await as(jr, "POST", `/api/admin/articles/${art.id}/review`, {});
  assert.equal(noImg.status, 400, "image principale obligatoire pour soumettre");
  assert.ok(/image principale/i.test(noImg.json.error));
  await giveImage(art.id);
  const r = await as(jr, "POST", `/api/admin/articles/${art.id}/review`, {});
  assert.equal(r.status, 200, r.text);
  assert.ok(r.json.article.reviewRequestedAt);
  assert.equal(mine().length, 1);
  assert.equal(mine()[0].data.title, "Article à approuver");
  assert.ok(mine()[0].data.body.includes("Reportage à valider"));
  assert.equal(mine()[0].data.url, `/admin#/articles/${art.id}`);
  assert.equal((await as(jr, "POST", `/api/admin/articles/${art.id}/review`, {})).status, 200, "redemande sans doublon");
  assert.equal(mine().length, 1, "pas de seconde notification");

  // rappel unique après 2 h ; la publication efface la demande
  const { remindReviews } = require("../server/scheduled");
  assert.equal(await remindReviews(), 0, "trop tôt");
  await db().query("UPDATE articles SET review_requested_at = now() - interval '3 hours' WHERE id = $1", [art.id]);
  assert.equal(await remindReviews(), 1);
  assert.equal(await remindReviews(), 0, "un seul rappel");
  await giveImage(art.id);
  assert.equal((await as(admin, "POST", `/api/admin/articles/${art.id}/status`, { status: "publie" })).status, 200);
  assert.equal((await db().query("SELECT review_requested_at FROM articles WHERE id = $1", [art.id]))[0].review_requested_at, null);

  // commentaires : prêt pour le futur système (canal « comments »), jamais déclenché aujourd'hui
  const before = mine().length;
  await require("../server/push").notifyNewComment({ articleTitle: "Reportage à valider", author: "Lectrice", slug: "reportage" });
  const c = mine().slice(before);
  assert.equal(c.length, 1);
  assert.equal(c[0].data.channel, "comments");
  delete process.env.FCM_TEST_SINK;
});

/* ═════════════════════════ PUSH POUR LES AUTRES RÔLES ═════════════════════════ */
test("push : retours aux auteurs, traductions, comptes, sécurité, commercial, programmés bloqués", async () => {
  process.env.FCM_TEST_SINK = "1";
  global.__pushSent = [];
  const pw = "un mot de passe solide 2026";
  const admin = await loginAs("admin@hnetmedia.com", pw, 220);
  const mk = async (email, name, role) => (await as(admin, "POST", "/api/admin/users", { email, name, role, password: pw })).status;
  const tok = (k) => `token-${k}-0123456789-abcdefghijklmnop`;
  const reg = async (s, k) => assert.equal((await as(s, "POST", "/api/admin/devices", { token: tok(k) })).status, 200);
  const got = (k) => global.__pushSent.filter((x) => x.token === tok(k)).map((x) => x.data);
  await reg(admin, "admin");

  // comptes : l'admin est prévenu d'un nouveau compte créé par un AUTRE admin seulement
  assert.equal(await mk("push-chef@hnetmedia.com", "Chef Rédac", "redacteur_en_chef"), 201);
  assert.equal(got("admin").filter((d) => d.title === "Nouveau compte créé").length, 0, "on ne prévient pas l'auteur de l'action");
  const chef = await loginAs("push-chef@hnetmedia.com", pw, 221);
  await reg(chef, "chef");
  assert.equal(await mk("push-ed@hnetmedia.com", "Édith Éditrice", "editeur"), 201);
  assert.equal(got("chef").length, 0, "le rédacteur en chef n'a pas la permission user.manage");
  assert.ok(got("admin").length === 0);
  const ed = await loginAs("push-ed@hnetmedia.com", pw, 222); await reg(ed, "ed");
  assert.equal(await mk("push-jr2@hnetmedia.com", "Julie Journaliste", "journaliste"), 201);
  const jr = await loginAs("push-jr2@hnetmedia.com", pw, 223); await reg(jr, "jr");
  assert.equal(await mk("push-com@hnetmedia.com", "Carl Commercial", "commercial"), 201);
  const com = await loginAs("push-com@hnetmedia.com", pw, 224); await reg(com, "com");
  // création par le chef impossible (pas de droit) ; création d'un compte par l'admin prévient un 2e admin
  assert.equal(await mk("push-admin2@hnetmedia.com", "Second Admin", "administrateur"), 201);
  const adm2 = await loginAs("push-admin2@hnetmedia.com", pw, 225); await reg(adm2, "adm2");
  assert.equal(await mk("push-tmp@hnetmedia.com", "Compte Temporaire", "contributeur"), 201);
  assert.equal(got("adm2").filter((d) => d.title === "Nouveau compte créé").length, 1, "2e administrateur prévenu");

  // sécurité : verrouillage d'un compte → administrateurs prévenus, une seule fois
  for (let i = 0; i < 5; i++) await call("POST", "/api/admin/auth/login", { body: { email: "push-tmp@hnetmedia.com", password: "mauvais mot de passe 000" }, headers: ip(230 + i) });
  const locks = got("admin").filter((d) => d.title === "Compte verrouillé");
  assert.equal(locks.length, 1, "une seule alerte de verrouillage");
  assert.ok(!JSON.stringify(locks[0]).includes("mauvais"), "aucun secret dans la notification");

  // retours aux auteurs
  const art = (await as(jr, "POST", "/api/admin/articles", { title: "Enquête de Julie", category: "culture" })).json.article;
  assert.equal((await as(jr, "PUT", `/api/admin/articles/${art.id}`, { translations: { fr: { title: "Enquête de Julie", content: "<p>Texte.</p>" }, en: { title: "Julie's investigation", content: "<p>Text.</p>", reviewed: false } }, authorName: "Julie Journaliste" })).status, 200);
  await giveImage(art.id);
  assert.equal((await as(jr, "POST", `/api/admin/articles/${art.id}/review`, {})).status, 200);
  assert.ok(got("chef").some((d) => d.title === "Article à approuver"), "rédacteur en chef prévenu");
  assert.equal((await as(jr, "POST", `/api/admin/articles/${art.id}/review-return`, {})).status, 403, "journaliste ne peut pas renvoyer");
  let r = await as(chef, "POST", `/api/admin/articles/${art.id}/review-return`, { note: "Ajoutez une source" });
  assert.equal(r.status, 200, r.text);
  const back = got("jr").find((d) => d.title === "Article renvoyé pour modifications");
  assert.ok(back && back.body.includes("Ajoutez une source"), "journaliste prévenu avec le mot du chef");
  assert.equal((await as(chef, "POST", `/api/admin/articles/${art.id}/review-return`, {})).status, 400, "plus en attente");

  // publication par le chef : l'auteur + l'éditeur (traduction) sont prévenus, pas le chef
  await giveImage(art.id);
  assert.equal((await as(chef, "POST", `/api/admin/articles/${art.id}/status`, { status: "publie" })).status, 200);
  assert.ok(got("jr").some((d) => d.title === "Votre article est publié"), "auteur prévenu de la publication");
  assert.ok(got("ed").some((d) => d.title === "Traduction anglaise à valider"), "éditeur prévenu de la traduction à valider");
  assert.ok(!got("chef").some((d) => d.title === "Votre article est publié"), "l'acteur n'est pas prévenu");
  assert.equal(got("com").length, 0, "commercial ne reçoit rien du contenu éditorial : " + JSON.stringify(got("com")));

  // correction → auteur prévenu
  assert.equal((await as(chef, "POST", `/api/admin/articles/${art.id}/corrections`, { text: "Le nom a été corrigé." })).status, 201);
  assert.ok(got("jr").some((d) => d.title === "Correction publiée sur votre article"));

  // article sponsorisé publié → commercial prévenu
  const sp = (await as(chef, "POST", "/api/admin/articles", { title: "Contenu sponsorisé", category: "culture" })).json.article;
  assert.equal((await as(chef, "PUT", `/api/admin/articles/${sp.id}`, { translations: { fr: { title: "Contenu sponsorisé", content: "<p>Pub.</p>" } }, authorName: "Rédaction" })).status, 200);
  await db().query("UPDATE articles SET sponsored = true WHERE id = $1", [sp.id]);
  await giveImage(sp.id);
  assert.equal((await as(chef, "POST", `/api/admin/articles/${sp.id}/status`, { status: "publie" })).status, 200);
  assert.ok(got("com").some((d) => d.title === "Article sponsorisé publié"), "commercial prévenu");

  // contact « Publicité » → commercial prévenu ; « Rédaction » → non
  await db().query(`INSERT INTO site_settings (key, value) VALUES ('contactCategories', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(["Rédaction", "Correction", "Publicité", "Partenariat", "Recrutement", "Autre"])]);
  const base = { name: "Annonceur SA", email: "pub@example.org", subject: "Encart", message: "Nous voulons un encart publicitaire.", hp: "", ts: formTs() };
  assert.equal((await call("POST", "/api/contact", { body: { ...base, category: "Rédaction" }, headers: ip(240) })).status, 200);
  assert.equal(got("com").filter((d) => d.title.startsWith("Demande")).length, 0);
  assert.equal((await call("POST", "/api/contact", { body: { ...base, category: "Publicité" }, headers: ip(241) })).status, 200);
  assert.equal(got("com").filter((d) => d.title === "Demande : Publicité").length, 1);

  // programmé incomplet et échu → rédaction prévenue une seule fois
  await db().query("INSERT INTO articles (id, slug, status, category_slug, author_name, published_at) VALUES ('blq-1', 'bloque-1', 'programme', NULL, 'Rédaction', now() - interval '5 minutes')");
  await db().query("INSERT INTO article_translations (article_id, lang, title, content, reviewed) VALUES ('blq-1', 'fr', 'Bloqué', '<p>Texte</p>', true)");
  const { warnBlocked } = require("../server/scheduled");
  assert.ok(await warnBlocked() >= 1, "au moins notre article bloqué (d'autres tests en laissent un)");
  assert.equal(await warnBlocked(), 0, "une seule alerte");
  assert.ok(got("chef").some((d) => d.title === "Article programmé bloqué" && d.body.includes("bloque-1")));
  delete process.env.FCM_TEST_SINK;
});

/* ═════════════════════════ COMMENTAIRES DES LECTEURS ═════════════════════════ */
test("commentaires : dépôt protégé, pré-modération, réponses, droits, notifications, page d'article", async () => {
  const pw = "un mot de passe solide 2026";
  const admin = await loginAs("admin@hnetmedia.com", pw, 150);
  const mkUser = async (email, name, role) => assert.equal((await as(admin, "POST", "/api/admin/users", { email, name, role, password: pw })).status, 201);
  await mkUser("cm-ed@hnetmedia.com", "Édith Modératrice", "editeur");
  await mkUser("cm-jr@hnetmedia.com", "Jules Auteur", "journaliste");
  const ed = await loginAs("cm-ed@hnetmedia.com", pw, 151);
  const jr = await loginAs("cm-jr@hnetmedia.com", pw, 152);

  // article publié (écrit par le journaliste) + brouillon
  const mk = async (title, owner, publish, extra = {}) => {
    const art = (await as(owner, "POST", "/api/admin/articles", { title, category: "culture" })).json.article;
    assert.equal((await as(owner, "PUT", `/api/admin/articles/${art.id}`, { translations: { fr: { title, content: "<p>Texte de l'article.</p>", ...(extra.en ? {} : {}) }, ...(extra.en ? { en: { title: title + " (EN)", content: "<p>Article text.</p>", reviewed: true } } : {}) }, authorName: "Rédaction" })).status, 200);
    if (extra.en) assert.equal((await as(admin, "PUT", `/api/admin/articles/${art.id}`, { translations: { en: { title: title + " (EN)", content: "<p>Article text.</p>", reviewed: true } } })).status, 200, "traduction anglaise validée par l'administrateur");
    if (publish) { await giveImage(art.id); assert.equal((await as(admin, "POST", `/api/admin/articles/${art.id}/status`, { status: "publie" })).status, 200); }
    return (await as(admin, "GET", `/api/admin/articles/${art.id}`)).json.article;
  };
  const pubArt = await mk("Article commentable", jr, true, { en: true });
  const draft = await mk("Brouillon sans commentaires", jr, false);

  const post = (body, n, extraHeaders = {}) => call("POST", "/api/comments", { body: { article: pubArt.slug, name: "Marie Lecteur", email: "marie@example.org", body: "Merci pour cet article très clair.", hp: "", ts: formTs(), ...body }, headers: { ...ip(n), ...extraHeaders } });
  const list = async (slug = pubArt.slug) => (await call("GET", `/api/comments?article=${slug}`, { origin: null })).json;

  // lecture publique vide ; article inconnu ou brouillon : introuvable
  let r = await list();
  assert.deepEqual([r.ok, r.enabled, r.items.length], [true, true, 0]);
  assert.equal((await call("GET", `/api/comments?article=${draft.slug}`, { origin: null })).status, 404, "brouillon : pas de commentaires");
  assert.equal((await call("GET", "/api/comments?article=Mauvais Slug", { origin: null })).status, 400);

  // protections du dépôt
  assert.equal((await call("POST", "/api/comments", { body: { article: pubArt.slug, name: "Marie", body: "Bonjour à tous", hp: "", ts: formTs() }, origin: null, headers: ip(160) })).status, 403, "Origin absente");
  assert.equal((await post({ hp: "http://spam" }, 160)).status, 400, "champ piège");
  assert.equal((await post({ ts: Date.now() }, 161)).status, 400, "trop rapide");
  assert.equal((await post({ name: "M" }, 162)).status, 400, "nom trop court");
  assert.equal((await post({ body: "ok" }, 163)).status, 400, "commentaire trop court");
  assert.equal((await post({ email: "pas-un-email" }, 164)).status, 400);
  assert.equal((await post({ body: "Voir http://a.example http://b.example et http://c.example" }, 165)).status, 400, "trop de liens");
  assert.equal((await post({ article: "article-inconnu" }, 166)).status, 404);
  assert.equal((await post({ article: draft.slug }, 167)).status, 404, "brouillon : refusé");

  // dépôt valide : en attente, jamais public, e-mail et IP protégés
  r = await post({ name: "Marie\u0000 Lecteur" }, 170);
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.pending, true);
  assert.ok(/relecture|modération/i.test(r.json.message), "le message dit honnêtement qu'il y a relecture");
  const row = (await db().query("SELECT id, name, email, status::text s, ip_hash FROM comments"))[0];
  assert.equal(row.s, "en_attente");
  assert.equal(row.name, "Marie Lecteur", "caractères de contrôle retirés");
  assert.ok(row.ip_hash && !row.ip_hash.includes("10.0.0"), "IP jamais stockée en clair");
  assert.equal((await list()).items.length, 0, "non publié tant que non approuvé");
  assert.equal((await post({}, 170)).status, 409, "doublon refusé (même adresse, même texte)");
  assert.equal((await post({ parentId: row.id, body: "Réponse à un commentaire non approuvé." }, 172)).status, 400, "on ne répond pas à un commentaire non approuvé");

  // limitation de débit (2 / minute par adresse)
  assert.equal((await post({ body: "Deuxième commentaire différent." }, 173)).status, 201);
  assert.equal((await post({ body: "Troisième commentaire différent." }, 173)).status, 201);
  assert.equal((await post({ body: "Quatrième commentaire différent." }, 173)).status, 429, "rate limiting (2 par minute)");

  // modération : droits
  assert.equal((await call("GET", "/api/admin/comments")).status, 401);
  assert.equal((await as(jr, "GET", "/api/admin/comments")).status, 403, "journaliste : pas de modération");
  r = await as(ed, "GET", "/api/admin/comments?status=en_attente");
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.items.length, 3);
  assert.equal(r.json.counts.en_attente, 3);
  assert.equal(r.json.items[0].articleTitle, "Article commentable");

  // approbation + notification à l'auteur de l'article, pas au modérateur
  process.env.FCM_TEST_SINK = "1"; global.__pushSent = [];
  assert.equal((await as(jr, "POST", "/api/admin/devices", { token: "token-auteur-commentaire-0123456789abcdef" })).status, 200);
  assert.equal((await as(ed, "POST", "/api/admin/devices", { token: "token-moderateur-commentaire-0123456789abc" })).status, 200);
  assert.equal((await as(ed, "PATCH", `/api/admin/comments/${row.id}`, { status: "approuve" })).status, 200);
  assert.ok(global.__pushSent.some((x) => x.token.startsWith("token-auteur") && x.data.title === "Nouveau commentaire sur votre article" && x.data.channel === "comments"), "auteur prévenu");
  assert.ok(!global.__pushSent.some((x) => x.token.startsWith("token-moderateur")), "le modérateur n'est pas prévenu de sa propre action");
  r = await list();
  assert.equal(r.items.length, 1);
  assert.deepEqual(Object.keys(r.items[0]).sort(), ["body", "createdAt", "id", "name", "replies", "staff"], "aucune donnée privée (e-mail, IP) dans la réponse publique");

  // nouveau dépôt → modérateurs prévenus (canal comments)
  global.__pushSent = [];
  assert.equal((await post({ body: "Réponse du lecteur au premier commentaire.", parentId: row.id }, 174)).status, 201);
  assert.ok(global.__pushSent.some((x) => x.token.startsWith("token-moderateur") && x.data.title === "Commentaire à modérer" && x.data.channel === "comments"), "modérateur prévenu d'un dépôt");
  assert.ok(!global.__pushSent.some((x) => x.token.startsWith("token-auteur")), "le journaliste n'a pas la permission de modération");
  delete process.env.FCM_TEST_SINK;

  // réponses : approuver la réponse, réponse publique de la rédaction, imbrication
  const pending = (await as(ed, "GET", "/api/admin/comments?status=en_attente")).json.items;
  const replyRow = pending.find((c) => c.parentId === row.id);
  assert.ok(replyRow && replyRow.parentName === "Marie Lecteur");
  assert.equal((await as(ed, "PATCH", `/api/admin/comments/${replyRow.id}`, { status: "approuve" })).status, 200);
  assert.equal((await as(ed, "POST", `/api/admin/comments/${row.id}/reply`, { body: "Merci de votre lecture !" })).status, 201);
  r = await list();
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].replies.length, 2);
  assert.ok(r.items[0].replies.some((x) => x.staff && x.name === "Édith Modératrice"));
  assert.equal((await as(ed, "POST", `/api/admin/comments/${replyRow.id}/reply`, { body: "Réponse imbriquée trop profonde." })).status, 400, "un seul niveau de réponses");

  // refus / indésirable / suppression
  const others = (await as(ed, "GET", "/api/admin/comments?status=en_attente")).json.items;
  assert.equal(others.length, 2);
  assert.equal((await as(ed, "PATCH", `/api/admin/comments/${others[0].id}`, { status: "refuse" })).status, 200);
  assert.equal((await as(ed, "PATCH", `/api/admin/comments/${others[1].id}`, { status: "spam" })).status, 200);
  assert.equal((await as(ed, "PATCH", `/api/admin/comments/${others[1].id}`, { status: "inconnu" })).status, 400);
  assert.equal((await list()).items.length, 1, "refusés et indésirables restent cachés");
  assert.equal((await as(ed, "DELETE", `/api/admin/comments/${others[1].id}`)).status, 200);
  assert.equal((await as(ed, "DELETE", `/api/admin/comments/${others[1].id}`)).status, 404);
  assert.ok((await db().query("SELECT 1 FROM audit_log WHERE action = 'commentaire.approuve'")).length >= 2, "modération journalisée");

  // rappel unique pour les commentaires en attente depuis plus de 30 min
  process.env.FCM_TEST_SINK = "1";
  assert.equal((await post({ body: "Un dernier commentaire en attente." }, 175)).status, 201);
  const { remindPending } = require("../server/comments");
  assert.equal(await remindPending(), 0, "trop tôt");
  await db().query("UPDATE comments SET created_at = now() - interval '1 hour' WHERE status = 'en_attente'");
  assert.equal(await remindPending(), 1);
  assert.equal(await remindPending(), 0, "un seul rappel");
  delete process.env.FCM_TEST_SINK;

  // fermeture globale des commentaires (Réglages)
  const cur = (await as(admin, "GET", "/api/admin/settings")).json.settings;
  assert.equal(cur.commentsEnabled, true);
  assert.equal((await as(admin, "PUT", "/api/admin/settings", { ...cur, commentsEnabled: false })).status, 200);
  assert.equal((await list()).enabled, false);
  assert.equal((await post({ body: "Commentaire pendant la fermeture." }, 176)).status, 503, "dépôt refusé quand fermé");
  assert.equal((await as(admin, "PUT", "/api/admin/settings", { ...cur, commentsEnabled: true })).status, 200);
  assert.equal((await list()).enabled, true);

  // page d'article : section commentaires en français et en anglais, build strict (aucune phrase non traduite)
  const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "hn-cm-"));
  execFileSync("node", ["build.js"], { cwd: ROOT, env: { ...process.env, BUILD_OUT: out, I18N_STRICT: "1" }, stdio: "pipe" });
  await db().query("INSERT INTO articles (id, slug, status, category_slug, author_name, published_at) VALUES ('legacy-1', 'ancien-sans-image', 'publie', 'culture', 'Rédaction', now() - interval '1 day')");
  await db().query("INSERT INTO article_translations (article_id, lang, title, content, reviewed) VALUES ('legacy-1', 'fr', 'Ancien article', '<p>Texte</p>', true)");
  const out2 = fs.mkdtempSync(path.join(os.tmpdir(), "hn-cm2-"));
  execFileSync("node", ["build.js"], { cwd: ROOT, env: { ...process.env, BUILD_OUT: out2, I18N_STRICT: "1" }, stdio: "pipe" });
  const mainOf = (h) => h.slice(h.indexOf("<main"), h.indexOf("</main>"));
  const withImg = fs.readFileSync(path.join(out2, "article", `${pubArt.slug}.html`), "utf8");
  assert.ok(withImg.includes('class="art-hero"') && !/logo\.png/.test(mainOf(withImg)), "en-tête : l'image de l'article, jamais le logo du site");
  assert.ok(withImg.includes('<meta property="og:image" content="https://www.hnetmedia.com/media/test-image">') && withImg.includes('<meta name="twitter:image" content="https://www.hnetmedia.com/media/test-image">'), "aperçu de lien : l'image principale");
  const legacy = fs.readFileSync(path.join(out2, "article", "ancien-sans-image.html"), "utf8");
  assert.ok(!legacy.includes("art-hero") && !/logo\.png/.test(mainOf(legacy)) && legacy.includes("art-plain"), "ancien article sans image : ni photo ni logo en haut");
  const frPage = fs.readFileSync(path.join(out, "article", `${pubArt.slug}.html`), "utf8");
  assert.ok(frPage.includes('id="comments"') && frPage.includes(`data-article="${pubArt.slug}"`) && frPage.includes(">Commentaires<") && frPage.includes("/assets/comments.js") && frPage.includes("/assets/comments.css"));
  const enPage = fs.readFileSync(path.join(out, "en", "article", `${pubArt.slug}.html`), "utf8");
  assert.ok(enPage.includes(">Comments<") && enPage.includes("Send my comment") && !enPage.includes("Envoyer mon commentaire"), "version anglaise traduite");
});
