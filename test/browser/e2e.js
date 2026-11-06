// Test de navigateur (Playwright) de l'espace /admin, sur PostgreSQL LOCAL (jamais Neon).
// Prérequis : Playwright installé, PostgreSQL local sur 127.0.0.1:5433, `node build.js` exécuté.
// Lancer : node test/browser/e2e.js puis node test/browser/roles.js
const path = require("path");
const ROOT = require("path").join(__dirname, "..", "..");
const ADMIN_URL = "postgres://postgres@127.0.0.1:5433/postgres";
Object.assign(process.env, {
  DB_DRIVER: "pg", DATABASE_URL: "postgres://postgres@127.0.0.1:5433/hnet_e2e",
  HASH_SECRET: "secret-de-test-0123456789abcdef0123456789", ADMIN_SETUP_TOKEN: "code-installation-test-0123456789",
  SITE_URL: "http://127.0.0.1", BREVO_API_KEY: "t", EMAIL_FROM: "a@b.co", EMAIL_TEST_SINK: "1",
});
const { chromium, devices } = require("playwright");
const { Client } = require("pg");
const { execFileSync } = require("child_process");
const { start } = require(ROOT + "/test/e2e-server.js");
const SHOTS = require("os").tmpdir();
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✘ ") + m); if (!c) process.exitCode = 1; };

(async () => {
  const c = new Client({ connectionString: ADMIN_URL }); await c.connect();
  await c.query("DROP DATABASE IF EXISTS hnet_e2e WITH (FORCE)"); await c.query("CREATE DATABASE hnet_e2e"); await c.end();
  execFileSync("node", ["db/migrate.js"], { cwd: ROOT, env: process.env, stdio: "pipe" });
  const server = await start(ROOT + "/dist"); const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();

  for (const [name, ctxOpts] of [["mobile", { ...devices["Pixel 5"] }], ["desktop", { viewport: { width: 1280, height: 900 } }]]) {
    console.log("\n=== " + name + " ===");
    const ctx = await browser.newContext({ ...ctxOpts, baseURL: base }); const page = await ctx.newPage();
    await ctx.addInitScript(() => window.addEventListener("unhandledrejection", (e) => console.error("REJET: " + (e.reason && (e.reason.stack || e.reason.message) || e.reason)))); const errs = []; page.on("pageerror", (e) => errs.push(e.message)); page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    const email = `admin-${name}@hnetmedia.com`;
    if (name === "mobile") {
      await page.goto("/admin");
      await page.waitForSelector("#s-token");
      ok(true, "écran d'installation affiché (aucun compte)");
      await page.screenshot({ path: `${SHOTS}/${name}-1-setup.png` });
      await page.fill("#s-token", "mauvais-code-mauvais-code-000"); await page.fill("#s-name", "Joseph"); await page.fill("#s-email", email);
      await page.fill("#s-pw", "un mot de passe solide 2026"); await page.fill("#s-pw2", "un mot de passe solide 2026");
      await page.click("button[type=submit]"); await page.waitForSelector(".hn-alert:not([hidden])");
      ok(/invalide/i.test(await page.textContent(".hn-alert")), "faux code d'installation refusé avec un message clair");
      await page.fill("#s-token", "code-installation-test-0123456789"); await page.click("button[type=submit]");
      await page.waitForSelector("#l-email"); ok(true, "compte créé → écran de connexion");
    } else {
      await page.goto("/admin"); await page.waitForSelector("#l-email"); ok(true, "plus d'installation proposée une fois un compte créé");
      // le compte « desktop » est créé via l'API par l'admin mobile : on se connecte avec le même compte
    }
    const loginEmail = "admin-mobile@hnetmedia.com";
    await page.screenshot({ path: `${SHOTS}/${name}-2-login.png` });
    await page.fill("#l-email", "nimporte@x.co"); await page.fill("#l-pw", "mauvais mot de passe"); await page.click("button[type=submit]");
    await page.waitForSelector(".hn-alert:not([hidden])"); ok(/incorrects/i.test(await page.textContent(".hn-alert")), "mauvais identifiants refusés");
    await page.fill("#l-email", loginEmail); await page.fill("#l-pw", "un mot de passe solide 2026"); await page.click("button[type=submit]");
    await page.waitForSelector(".hn-tabs a"); ok(true, "connexion réussie");
    const tabs = await page.$$eval(".hn-tabs a", (a) => a.map((x) => x.textContent)); ok(tabs.length === 6, "onglets administrateur : " + tabs.join(", "));
    await page.waitForSelector(".hn-table, .empty-state");
    await page.screenshot({ path: `${SHOTS}/${name}-3-liste.png` });
    ok(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), "pas de débordement horizontal (liste)");

    // Nouvel article
    await page.click("text=+ Nouvel article"); await page.fill("#dlg-title", `Élections : le calendrier ${name}`); await page.selectOption("#dlg-category", "politique");
    await page.click(".hn-dlg button[type=submit]"); await page.waitForSelector("#a-title"); await page.waitForSelector(".hn-ed-prose");
    await page.waitForTimeout(300); ok((await page.inputValue("#a-title")).includes("calendrier"), "brouillon créé, éditeur ouvert");
    await page.fill("#a-kicker", "Scrutin 2026"); await page.fill("#a-excerpt", "Le Conseil électoral publie le calendrier officiel du scrutin.");

    // Éditeur riche
    const prose = page.locator(".hn-ed-prose"); await prose.click();
    await page.keyboard.type("Introduction de l'article. ");
    await page.keyboard.press("Control+b"); await page.keyboard.type("Texte en gras"); await page.keyboard.press("Control+b"); await page.keyboard.type(" puis normal.");
    await page.keyboard.press("Enter");
    await page.selectOption(".hn-ed-select", "2"); await page.keyboard.type("Un intertitre"); await page.keyboard.press("Enter");
    await page.click(".hn-ed-bullet"); await page.keyboard.type("Premier point"); await page.keyboard.press("Enter"); await page.keyboard.type("Deuxième point"); await page.keyboard.press("Enter"); await page.keyboard.press("Enter");
    await page.click(".hn-ed-quote"); await page.keyboard.type("Une citation marquante."); await page.keyboard.press("Enter"); await page.keyboard.press("Enter");
    const dump = async (l) => console.log("  [" + l + "]", (await page.evaluate(() => document.querySelector(".hn-ed-prose").innerHTML)).replace(/<br class="ProseMirror-trailingBreak">/g,"¶").slice(-260));
    await dump("après citation"); await page.keyboard.type("Lien vers le CEP"); await dump("après texte lien"); await page.keyboard.press("Shift+Home"); await page.click(".hn-ed-link");
    await page.fill("#dlg-href", "cep.ht"); await page.click(".hn-dlg button[type=submit]");
    await page.locator(".hn-ed-prose > p").last().click();
    await page.click(".hn-ed-image");
    await page.fill("#dlg-src", "http://pas-https.example/x.jpg"); await page.fill("#dlg-alt", "Description");
    await page.click(".hn-dlg button[type=submit]");
    ok(/https:\/\//.test(await page.textContent(".hn-dlg .hn-alert")), "adresse d'image non sécurisée refusée DANS la fenêtre (saisie conservée)");
    ok((await page.inputValue("#dlg-alt")) === "Description", "la saisie n'est pas perdue");
    await page.fill("#dlg-src", "https://example.org/photo.jpg"); await page.fill("#dlg-alt", "Le siège du conseil électoral"); await page.fill("#dlg-caption", "Le siège du CEP. Photo : Rédaction");
    await page.click(".hn-dlg button[type=submit]");
    await page.click(".hn-ed-table");
    const html = await page.evaluate(() => document.querySelector(".hn-ed-prose").innerHTML);
    ok(/<strong>Texte en gras<\/strong>/.test(html), "gras");
    ok(/<h2[^>]*>Un intertitre<\/h2>/.test(html), "intertitre H2");
    ok(/<ul[^>]*>[\s\S]*Deuxième point/.test(html), "liste à puces");
    ok(/<blockquote/.test(html), "citation");
    ok(/href="https:\/\/cep\.ht\/?"/.test(html), "lien normalisé en https");
    ok(/<figure[^>]*>[\s\S]*alt="Le siège du conseil électoral"[\s\S]*<figcaption>Le siège du CEP/.test(html), "image avec texte alternatif et légende");
    ok(/<table/.test(html), "tableau inséré");
    ok(await page.isVisible(".hn-ed-row-add"), "boutons de tableau visibles dans un tableau");
    ok(/\d+ mots/.test(await page.textContent(".hn-ed-status")), "compteur : " + (await page.textContent(".hn-ed-status")));

    await page.fill("#a-sign", "La rédaction"); await page.fill("#a-tags", "élections, CEP");
    await page.click("text=Enregistrer"); await page.waitForSelector(".hn-toast"); ok(/enregistré/i.test(await page.textContent(".hn-toast")), "enregistrement");
    await page.screenshot({ path: `${SHOTS}/${name}-4-editeur.png`, fullPage: true });
    ok(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), "pas de débordement horizontal (éditeur)");

    await page.reload(); await page.waitForSelector(".hn-ed-prose");
    const html2 = await page.evaluate(() => document.querySelector(".hn-ed-prose").innerHTML);
    ok(/Un intertitre/.test(html2) && /figcaption/.test(html2) && /<table/.test(html2) && /noopener/.test(html2), "contenu intact après rechargement (nettoyé par le serveur)");
    ok((await page.inputValue("#a-tags")).includes("CEP"), "mots-clés conservés");

    // Aperçu
    await page.click("text=Aperçu"); await page.waitForSelector(".hn-dlg .article-body"); await page.screenshot({ path: `${SHOTS}/${name}-5-apercu.png` });
    await page.click(".hn-dlg >> text=Fermer");

    // Publication
    await page.click("text=Publier maintenant"); await page.click(".hn-dlg button:has-text(\"Publier\")");
    await page.waitForSelector(".hn-toast"); const toastTxt = await page.textContent(".hn-toast"); ok(/publié/i.test(toastTxt), "publication : " + toastTxt);
    ok(/Publié/.test(await page.textContent(".hn-side .badge")), "badge « Publié »");
    ok(await page.isVisible("text=Publier la correction"), "formulaire de correction affiché pour un article publié");

    // Messages / comptes / stats / compte
    for (const [hash, sel] of [["#/messages", ".empty-state"], ["#/abonnes", ".hn-card"], ["#/stats", ".empty-state"], ["#/comptes", ".hn-table"], ["#/compte", "#p-cur"]]) {
      await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForSelector(sel); await page.waitForTimeout(150);
      ok(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), `pas de débordement horizontal (${hash})`);
    }
    await page.screenshot({ path: `${SHOTS}/${name}-6-compte.png` });
    await page.click("text=Déconnexion"); await page.waitForSelector("#l-email"); ok(true, "déconnexion");
    await page.goto("/admin#/articles"); await page.waitForSelector("#l-email"); ok(true, "après déconnexion, /admin redemande la connexion");
    const real = errs.filter((x) => !/status of (401|403)|ERR_TUNNEL|ERR_NAME|ERR_INTERNET/.test(x)); ok(real.length === 0, "aucune erreur JavaScript réelle" + (real.length ? " : " + real.join(" | ") : ""));
    await ctx.close();
  }
  await browser.close(); server.close(); await require(ROOT + "/server/db").getDb().end();
})().catch((e) => { console.error("ÉCHEC :", e.message.split("\n").slice(0, 6).join("\n")); process.exit(1); });
