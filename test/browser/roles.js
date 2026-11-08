// Droits par rôle dans l'interface /admin — à lancer APRÈS test/browser/e2e.js (réutilise sa base).
const ROOT = require("path").join(__dirname, "..", "..");
Object.assign(process.env, { DB_DRIVER: "pg", DATABASE_URL: "postgres://postgres@127.0.0.1:5433/hnet_e2e", HASH_SECRET: "secret-de-test-0123456789abcdef0123456789", SITE_URL: "http://127.0.0.1" });
const { chromium, devices } = require("playwright");
const { start } = require(ROOT + "/test/e2e-server.js");
const { hashPassword } = require(ROOT + "/server/auth.js");
const { getDb } = require(ROOT + "/server/db.js");
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✘ ") + m); if (!c) process.exitCode = 1; };
(async () => {
  const db = getDb(); const pw = "mot de passe de test 2026";
  for (const [email, role] of [["contrib@h.com", "contributeur"], ["commercial@h.com", "commercial"], ["chef@h.com", "redacteur_en_chef"]]) {
    await db.query("INSERT INTO users (email, display_name, password_hash, role_id) SELECT $1,$2,$3,id FROM roles WHERE code=$4 ON CONFLICT DO NOTHING", [email, role, await hashPassword(pw), role]);
  }
  const server = await start(ROOT + "/dist"); const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  async function login(email, ctxOpts) {
    const ctx = await browser.newContext({ ...ctxOpts, baseURL: base }); const page = await ctx.newPage();
    await page.goto("/admin"); await page.fill("#l-email", email); await page.fill("#l-pw", pw); await page.click("button[type=submit]"); await page.waitForSelector(".hn-tabs a");
    return { ctx, page, tabs: await page.$$eval(".hn-tabs a", (a) => a.map((x) => x.textContent)) };
  }
  console.log("— Contributeur (mobile)");
  let { ctx, page, tabs } = await login("contrib@h.com", devices["Pixel 5"]);
  ok(tabs.join() === "Articles,Médias,Mon compte", "onglets limités : " + tabs.join(", "));
  await page.waitForSelector(".hn-table, .empty-state");
  ok(!(await page.isVisible("text=Titre de l'article (exemple")), "ne voit pas les articles des autres (ni le brouillon-modèle)");
  await page.click("text=+ Nouvel article"); await page.fill("#dlg-title", "Mon brouillon de contributeur"); await page.click(".hn-dlg button[type=submit]"); await page.waitForSelector(".hn-ed-prose");
  ok(!(await page.isVisible(".wd-publish")) && !(await page.isVisible("text=Archiver")) && !(await page.isVisible("text=Supprimer définitivement")), "pas de menu Publier, ni Archiver, ni Supprimer");
  // le contributeur peut tout de même illustrer son brouillon (droit « téléverser »)
  await page.click('.wd-tab[data-tab=insertion]'); await page.click(".hn-ed-ins-image"); await page.waitForSelector("#img-alt");
  const png = await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 800; c.height = 500; const x = c.getContext("2d"); x.fillStyle = "#FF6B00"; x.fillRect(0, 0, 800, 500); return c.toDataURL("image/png").split(",")[1]; });
  await page.setInputFiles("#img-file", { name: "photo.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await page.waitForFunction(() => /800 × 500 px/.test(document.querySelector(".pk-prev p").textContent), null, { timeout: 15000 });
  await page.fill("#img-alt", "Aplat orange de test"); await page.click(".hn-dlg button[type=submit]"); await page.waitForSelector(".hn-ed-prose figure img");
  ok(/^\/media\//.test(await page.getAttribute(".hn-ed-prose figure img", "src")), "le contributeur téléverse une image dans son brouillon");
  ok(!(await page.isVisible("#a-feat")), "pas de case « À la une »");
  ok(await page.isDisabled("#a-rev") , "ne peut pas valider une traduction");
  const r = await page.evaluate(async () => (await fetch("/api/admin/users", { credentials: "same-origin" })).status);
  ok(r === 403, "API des comptes refusée (403)");
  await page.goto("/admin#/articles/00000000-0000-0000-0000-000000000000"); await page.reload(); await page.waitForSelector(".hn-alert, .hn-ed-prose");
  ok(await page.isVisible(".hn-alert"), "article d'un autre / inconnu : message d'erreur, pas d'accès");
  await ctx.close();
  console.log("— Commercial (ordinateur)");
  ({ ctx, page, tabs } = await login("commercial@h.com", { viewport: { width: 1280, height: 900 } }));
  ok(tabs.includes("Messages") && !tabs.includes("Comptes"), "onglets : " + tabs.join(", "));
  await page.waitForSelector(".hn-table, .empty-state");
  const link = page.locator(".hn-table a.hn-link").filter({ hasText: "calendrier" }).first(); await link.click(); await page.waitForSelector("#a-title");
  ok(await page.isDisabled("#a-title"), "contenu éditorial en lecture seule");
  ok(await page.isVisible("text=Contenu sponsorisé"), "mais peut marquer « sponsorisé »");
  await ctx.close();
  console.log("— Rédacteur en chef (mobile) : publié → correction");
  ({ ctx, page, tabs } = await login("chef@h.com", devices["Pixel 5"]));
  await page.waitForSelector(".hn-table"); await page.locator(".hn-table a.hn-link").filter({ hasText: "calendrier" }).first().click(); await page.waitForSelector("#a-title");
  await page.click(".wd-publish"); ok(await page.isVisible('.wd-menuitem:has-text("Dépublier")') && await page.isVisible('.wd-menuitem:has-text("Archiver")'), "peut dépublier et archiver"); await page.keyboard.press("Escape");
  ok(!(await page.isVisible("text=Supprimer définitivement")), "ne peut pas supprimer (administrateur seulement)");
  if (!(await page.isVisible("text=Corrections publiques"))) await page.click(".wd-panebtn");
  await page.click('[data-sec=cor] summary');
  await page.fill("textarea[aria-label='Texte de la correction']", "La date du scrutin a été corrigée."); await page.click("text=Publier la correction");
  await page.waitForSelector(".correction-note"); ok(true, "correction publiée et affichée");
  await ctx.close();
  await browser.close(); server.close(); await db.end();
})().catch((e) => { console.error("ÉCHEC :", e.message.split("\n").slice(0, 5).join("\n")); process.exit(1); });
