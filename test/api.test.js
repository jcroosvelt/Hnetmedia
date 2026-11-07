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
  assert.equal(r.json.permissions.length, 23);

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
  assert.deepEqual(r.json, { ok: true, database: true, hashSecret: true, deployHook: true, siteUrl: "https://www.hnetmedia.com" }, "le test configure un faux Deploy Hook et une adresse de site");
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
