// Contenu partagé depuis une autre application (window.onAppShare) → brouillon — à lancer APRÈS test/browser/e2e.js.
const ROOT = require("path").join(__dirname, "..", "..");
Object.assign(process.env, { DB_DRIVER: "pg", DATABASE_URL: "postgres://postgres@127.0.0.1:5433/hnet_e2e", HASH_SECRET: "secret-de-test-0123456789abcdef0123456789", SITE_URL: "http://127.0.0.1" });
const { chromium, devices } = require("playwright");
const { start } = require(ROOT + "/test/e2e-server.js");
const { hashPassword } = require(ROOT + "/server/auth.js");
const { getDb } = require(ROOT + "/server/db.js");
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✘ ") + m); if (!c) process.exitCode = 1; };
// PNG 64×48 valide (base64) : une vraie image que le navigateur sait décoder
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAAU0lEQVR4nO3PQQ3AIADAQEADwpCNrIngcVnSU9DOe/b4s6UDXjWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaB9VqsBjGUz7hsAAAAASUVORK5CYII=";
(async () => {
  const db = getDb(); const pw = "mot de passe de test 2026";
  for (const [email, role] of [["partage-ed@h.com", "administrateur"], ["partage-com@h.com", "commercial"]]) {
    await db.query("INSERT INTO users (email, display_name, password_hash, role_id) SELECT $1,$2,$3,id FROM roles WHERE code=$4 ON CONFLICT DO NOTHING", [email, "Partage " + role, await hashPassword(pw), role]);
  }
  const server = await start(ROOT + "/dist"); const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  async function open(email) {
    const ctx = await browser.newContext({ ...devices["Pixel 5"], baseURL: base }); const page = await ctx.newPage();
    const acks = []; await page.exposeFunction("__ack", (m) => acks.push(m));
    await ctx.addInitScript(() => { window.AppBridge = { postMessage: (m) => window.__ack(m) }; });
    page.on("dialog", (d) => d.accept().catch(() => {}));
    return { ctx, page, acks };
  }
  console.log("— Texte + lien + photo partagés AVANT la connexion");
  let { ctx, page, acks } = await open("partage-ed@h.com");
  await ctx.addInitScript((png) => { window.__appShare = { subject: "", text: "Réunion de la CEP demain https://example.org/cep-calendrier\nLe calendrier officiel est publié.", skipped: 1, files: [{ name: "photo.png", mime: "image/png", data: png }, { name: "clip.mp4", mime: "video/mp4", data: "AAAA" }] }; }, PNG);
  await page.goto("/admin"); await page.fill("#l-email", "partage-ed@h.com"); await page.fill("#l-pw", pw); await page.click("button[type=submit]");
  await page.waitForSelector(".hn-dlg input#dlg-title"); ok(true, "la fenêtre « Créer un brouillon ? » s'ouvre après la connexion");
  const intro = await page.textContent(".hn-dlg"); ok(/1 photo/.test(intro) && /1 lien/.test(intro) && /du texte/.test(intro), "résumé du contenu reçu");
  ok(/2 fichier\(s\) ignoré/.test(intro), "la vidéo et le fichier refusé par l'application sont signalés comme ignorés");
  ok(acks.includes("shareack:"), "accusé de réception envoyé à l'application");
  ok((await page.inputValue("#dlg-title")).startsWith("Réunion de la CEP demain"), "titre proposé : première ligne du texte");
  await page.fill("#dlg-alt", "Salle de réunion de la CEP");
  await page.click(".hn-dlg button[type=submit]"); await page.waitForSelector(".hn-ed-prose", { timeout: 15000 }); ok(true, "l'éditeur du nouveau brouillon s'ouvre");
  const id = decodeURIComponent((await page.url()).split("#/articles/")[1]);
  const a = (await db.query("SELECT a.status::text s, a.img_alt, m.alt, t.title, t.content FROM articles a LEFT JOIN media m ON m.id = a.main_media_id LEFT JOIN article_translations t ON t.article_id = a.id AND t.lang = 'fr' WHERE a.id = $1", [id]).catch(() => []))[0]
    || (await db.query("SELECT a.status::text s, m.alt, t.title, t.content FROM articles a LEFT JOIN media m ON m.id = a.main_media_id LEFT JOIN article_translations t ON t.article_id = a.id AND t.lang = 'fr' WHERE a.id = $1", [id]))[0];
  ok(a && a.s === "brouillon", "créé en BROUILLON (jamais publié)");
  ok(a && /Le calendrier officiel est publié/.test(a.content) && /example\.org\/cep-calendrier/.test(a.content), "texte et lien enregistrés");
  ok(a && a.alt === "Salle de réunion de la CEP", "photo ajoutée comme image principale avec sa description");
  const src = await db.query("SELECT url FROM article_sources WHERE article_id = $1", [id]); ok(src.length === 1 && src[0].url === "https://example.org/cep-calendrier", "lien ajouté aux sources");
  await ctx.close();

  console.log("— Partage reçu une fois connecté, puis annulation");
  ({ ctx, page } = await open("partage-ed@h.com"));
  await page.goto("/admin"); await page.fill("#l-email", "partage-ed@h.com"); await page.fill("#l-pw", pw); await page.click("button[type=submit]"); await page.waitForSelector(".hn-tabs a");
  const before = (await db.query("SELECT count(*)::int n FROM articles"))[0].n;
  await page.evaluate(() => window.onAppShare({ text: "Un simple texte partagé", files: [] }));
  await page.waitForSelector(".hn-dlg input#dlg-title"); await page.click(".hn-dlg button:has-text('Annuler')");
  ok((await db.query("SELECT count(*)::int n FROM articles"))[0].n === before, "annuler ne crée rien");
  await ctx.close();

  console.log("— Rôle sans droit de création");
  ({ ctx, page } = await open("partage-com@h.com"));
  await page.goto("/admin"); await page.fill("#l-email", "partage-com@h.com"); await page.fill("#l-pw", pw); await page.click("button[type=submit]"); await page.waitForSelector(".hn-tabs a");
  await page.evaluate(() => window.onAppShare({ text: "Texte partagé", files: [] }));
  await page.waitForSelector(".hn-toast.err"); ok(/ne permet pas/.test(await page.textContent(".hn-toast.err")), "message clair, aucun brouillon");
  ok((await page.locator(".hn-dlg").count()) === 0, "pas de fenêtre de création");
  await ctx.close(); await browser.close(); server.close();
  process.exit(process.exitCode || 0);
})();
