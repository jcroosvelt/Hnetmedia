// Test de navigateur (Playwright) de l'espace /admin, sur PostgreSQL LOCAL (jamais Neon).
// Prérequis : Playwright installé, PostgreSQL local sur 127.0.0.1:5433, `node build.js` exécuté.
// Lancer : node test/browser/e2e.js puis node test/browser/roles.js
const path = require("path");
const ROOT = require("path").join(__dirname, "..", "..");
const ADMIN_URL = "postgres://postgres@127.0.0.1:5433/postgres";
Object.assign(process.env, {
  DB_DRIVER: "pg", DATABASE_URL: "postgres://postgres@127.0.0.1:5433/hnet_e2e",
  HASH_SECRET: "secret-de-test-0123456789abcdef0123456789", ADMIN_SETUP_TOKEN: "code-installation-test-0123456789",
  SITE_URL: "http://127.0.0.1", RESEND_API_KEY: "t", EMAIL_FROM: "a@b.co", EMAIL_TEST_SINK: "1",
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
    const tabs = await page.$$eval(".hn-tabs a", (a) => a.map((x) => x.textContent)); ok(tabs.length === 12 && tabs[0] === "Tableau de bord", "onglets administrateur : " + tabs.join(", "));
    // le tableau de bord est la page d'accueil : chiffres réels, aucune donnée inventée
    await page.waitForSelector(".hn-kpi"); ok(/Tableau de bord/.test(await page.textContent(".hn-h1")) && (await page.locator(".hn-kpi").count()) === 4 && (await page.locator(".hn-kpi.dark").count()) === 1, "tableau de bord : titre, 4 indicateurs (le premier en avant)");
    ok((await page.locator(".hn-donut").count()) === 1 && (await page.locator(".hn-rank, .hn-ghost").count()) >= 3, "tableau de bord : classements (ou état vide honnête), répartition des articles");
    ok(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), "pas de débordement horizontal (tableau de bord)");
    await page.screenshot({ path: `${SHOTS}/${name}-2b-tableau.png`, fullPage: true });
    await page.click('.hn-tabs a:has-text("Articles")');
    await page.waitForSelector(".hn-table, .empty-state");
    await page.screenshot({ path: `${SHOTS}/${name}-3-liste.png` });
    ok(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), "pas de débordement horizontal (liste)");

    // Nouvel article
    await page.click("text=+ Nouvel article"); await page.fill("#dlg-title", `Élections : le calendrier ${name}`); await page.selectOption("#dlg-category", "politique");
    await page.click(".hn-dlg button[type=submit]"); await page.waitForSelector("#a-title"); await page.waitForSelector(".hn-ed-prose");
    await page.waitForTimeout(300); ok((await page.inputValue("#a-title")).includes("calendrier"), "brouillon créé, éditeur ouvert");
    await page.fill("#a-kicker", "Scrutin 2026"); await page.fill("#a-excerpt", "Le Conseil électoral publie le calendrier officiel du scrutin.");

    // Structure façon traitement de texte
    const vis = async (sel) => page.isVisible(sel);
    ok((await vis(".wd-title")) && (await vis(".wd-ribbon")) && (await vis(".wd-sheet")) && (await vis(".wd-statusbar")), "structure : barre de titre, ruban d'onglets, feuille, barre d'état");
    ok(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), "pas de débordement horizontal (éditeur)");
    const tabTxt = (await page.$$eval(".wd-tab:not([hidden])", (a) => a.map((x) => x.textContent))).join();
    ok(tabTxt === "Accueil,Insertion,Affichage", "onglets du ruban : " + tabTxt + " (« Tableau » n'apparaît que dans un tableau)");
    const sheetBox = await page.locator(".wd-sheet").boundingBox();
    ok(name === "mobile" ? sheetBox.width <= 400 : sheetBox.width <= 845 && sheetBox.width > 600, `feuille ${Math.round(sheetBox.width)} px de large`);
    const openPane = async () => { if (!(await vis("#a-sign"))) { await page.click(".wd-panebtn"); await page.waitForSelector("#a-sign"); } };
    const closePane = async () => { if (name === "mobile" && (await vis(".wd-paneclose"))) await page.click(".wd-paneclose"); };

    await page.fill("#a-kicker", "Scrutin 2026"); await page.fill("#a-excerpt", "Le Conseil électoral publie le calendrier officiel du scrutin.");

    // Éditeur riche
    const prose = page.locator(".hn-ed-prose"); await prose.click();
    await page.keyboard.type("Introduction de l'article. ");
    await page.keyboard.press("Control+b"); await page.keyboard.type("Texte en gras"); await page.keyboard.press("Control+b"); await page.keyboard.type(" puis normal.");
    await page.keyboard.press("Enter");
    await page.selectOption(".hn-ed-select", "2"); await page.keyboard.type("Un intertitre"); await page.keyboard.press("Enter");
    await page.click(".hn-ed-bullet"); await page.keyboard.type("Premier point"); await page.keyboard.press("Enter"); await page.keyboard.type("Deuxième point"); await page.keyboard.press("Enter"); await page.keyboard.press("Enter");
    await page.click(".hn-ed-quote"); await page.keyboard.type("Une citation marquante."); await page.keyboard.press("Enter"); await page.keyboard.press("Enter");
    await page.keyboard.type("Lien vers le CEP"); await page.keyboard.press("Shift+Home"); await page.click(".hn-ed-link");
    await page.fill("#dlg-href", "cep.ht"); await page.click(".hn-dlg button[type=submit]");
    await page.keyboard.press("Control+Home"); await page.click(".hn-ed-alignCenter");
    await page.locator(".hn-ed-prose > p").last().click();

    // Images : refus propres puis téléversement réel
    await page.click('.wd-tab[data-tab=insertion]'); await page.click(".hn-ed-ins-image"); await page.waitForSelector("#img-alt");
    await page.fill("#img-alt", "Description"); await page.click(".hn-dlg button[type=submit]");
    ok(/Choisissez une image/.test(await page.textContent(".hn-dlg .hn-alert")), "aucune image choisie : message clair, fenêtre conservée");
    await page.click('.wd-seg button[data-t=url]'); await page.fill("#img-url", "http://pas-https.example/x.jpg"); await page.click(".hn-dlg button[type=submit]");
    ok(/https:\/\//.test(await page.textContent(".hn-dlg .hn-alert")), "adresse non sécurisée refusée DANS la fenêtre");
    ok((await page.inputValue("#img-alt")) === "Description", "la saisie n'est pas perdue");
    await page.click('.wd-seg button[data-t=file]');
    await page.setInputFiles("#img-file", { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("pas une image") });
    await page.waitForFunction(() => /Format non pris en charge/.test(document.querySelector(".hn-dlg .hn-alert").textContent), null, { timeout: 8000 });
    ok(true, "fichier qui n'est pas une image refusé : « Format non pris en charge… »");
    const b64 = await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 2400; c.height = 1200; const x = c.getContext("2d"); x.fillStyle = "#0A1F44"; x.fillRect(0, 0, 2400, 1200); x.fillStyle = "#FF6B00"; x.fillRect(200, 200, 1000, 500); return c.toDataURL("image/png").split(",")[1]; });
    await page.setInputFiles("#img-file", { name: "photo-originale.png", mimeType: "image/png", buffer: Buffer.from(b64, "base64") });
    await page.waitForFunction(() => /1600 × 800 px/.test(document.querySelector(".pk-prev p").textContent), null, { timeout: 15000 });
    const info = await page.textContent(".pk-prev p"); ok(true, "photo 2400×1200 réduite sur l'appareil : " + info);
    await page.fill("#img-alt", ""); await page.click(".hn-dlg button[type=submit]");
    ok(/texte alternatif/i.test(await page.textContent(".hn-dlg .hn-alert")), "texte alternatif obligatoire");
    await page.fill("#img-alt", "Le siège du conseil électoral"); await page.fill("#img-cap", "Le siège du CEP. Photo : Rédaction");
    await page.click(".hn-dlg button[type=submit]"); await page.waitForSelector(".hn-ed-prose figure img");
    const imgSrc = await page.getAttribute(".hn-ed-prose figure img", "src");
    ok(/^\/media\/[0-9a-f-]{36}$/.test(imgSrc), "image téléversée insérée : " + imgSrc);
    const served = await page.evaluate(async (u) => { const r = await fetch(u); const b = await r.blob(); return { s: r.status, t: r.headers.get("content-type"), n: b.size, cache: r.headers.get("cache-control") }; }, imgSrc);
    ok(served.s === 200 && served.t === "image/webp" && served.n < 500000 && /immutable/.test(served.cache), `image servie : ${served.t}, ${Math.round(served.n / 1024)} Ko, cache immuable`);

    // médiathèque : réutiliser l'image sans la renvoyer
    await page.locator(".hn-ed-prose > p").last().click();
    await page.click(".hn-ed-ins-image"); await page.waitForSelector("#img-alt"); await page.click('.wd-seg button[data-t=lib]');
    await page.waitForSelector(".pk-thumb"); ok((await page.locator(".pk-thumb").count()) >= 1, "médiathèque : l'image téléversée est proposée");
    await page.locator(".pk-thumb").first().click(); await page.fill("#img-alt", "Même image, réutilisée"); await page.click(".hn-dlg button[type=submit]");
    await page.waitForFunction(() => document.querySelectorAll(".hn-ed-prose figure").length === 2, null, { timeout: 8000 }); ok(true, "image de la médiathèque réutilisée (2 images dans l'article)");

    // tableau
    await page.locator(".hn-ed-prose > p").last().click();
    await page.click(".hn-ed-ins-table"); await page.fill("#dlg-rows", "2"); await page.fill("#dlg-cols", "2"); await page.click(".hn-dlg button[type=submit]");
    await page.waitForSelector(".hn-ed-prose table");
    ok(await page.locator('.wd-tab[data-tab=tableau]').evaluate((e) => e.classList.contains("on") && !e.hidden), "dans un tableau : l'onglet « Tableau » apparaît et s'ouvre");
    await page.click(".hn-ed-row-below"); ok((await page.locator(".hn-ed-prose table tr").count()) === 3, "ligne ajoutée depuis l'onglet Tableau");

    const html = await page.evaluate(() => document.querySelector(".hn-ed-prose").innerHTML);
    ok(/<strong>Texte en gras<\/strong>/.test(html), "gras");
    ok(/<h2[^>]*>Un intertitre<\/h2>/.test(html), "intertitre H2");
    ok(/<ul[^>]*>[\s\S]*Deuxième point/.test(html), "liste à puces");
    ok(/<blockquote/.test(html), "citation");
    ok(/href="https:\/\/cep\.ht\/?"/.test(html), "lien normalisé en https");
    ok(/text-align: ?center/.test(html), "alignement centré");
    ok(/<figure[^>]*>[\s\S]*alt="Le siège du conseil électoral"[\s\S]*<figcaption>Le siège du CEP/.test(html), "image avec texte alternatif et légende");
    ok(/\d+ mots?/.test(await page.textContent(".wd-stats")), "compteur : " + (await page.textContent(".wd-stats")));
    ok(await page.isDisabled(".wd-save") === false, "« Enregistrer » actif après modification");
    ok(/non enregistrées/.test(await page.textContent(".wd-savestate")), "barre d'état : modifications non enregistrées");

    // zoom (onglet Affichage)
    await page.click('.wd-tab[data-tab=affichage]'); await page.click(".hn-ed-zoom-in"); ok((await page.textContent(".wd-zoomval")).includes("110"), "zoom 110 %"); await page.click(".hn-ed-zoom-100");
    await page.click('.wd-tab[data-tab=accueil]');

    // volet Propriétés + image principale
    await openPane();
    await page.fill("#a-sign", "La rédaction"); await page.fill("#a-tags", "élections, CEP");
    await page.click('[data-sec=img] summary'); await page.click(".wd-pickmain"); await page.waitForSelector("#img-alt");
    await page.click('.wd-seg button[data-t=lib]'); await page.waitForSelector(".pk-thumb"); await page.locator(".pk-thumb").first().click();
    await page.fill("#img-alt", "Vue du siège"); await page.fill("#img-cred", "Rédaction"); await page.click(".hn-dlg button[type=submit]");
    await page.waitForSelector(".wd-mainimg"); ok(/^\/media\//.test(await page.getAttribute(".wd-mainimg", "src")), "image principale choisie depuis la médiathèque");
    await closePane();

    // enregistrement (bouton puis Ctrl+S)
    await page.click(".wd-save"); await page.waitForSelector(".hn-toast"); ok(/enregistré/i.test(await page.textContent(".hn-toast")), "enregistrement");
    ok(/Enregistré à/.test(await page.textContent(".wd-savestate")), "barre d'état : " + (await page.textContent(".wd-savestate")));
    await page.fill("#a-title", `Élections : le calendrier ${name} (révisé)`); await page.waitForTimeout(150);
    await page.keyboard.press("Control+s"); await page.waitForFunction(() => /Enregistré à/.test(document.querySelector(".wd-savestate").textContent), null, { timeout: 8000 }); ok(true, "Ctrl+S enregistre");
    await page.screenshot({ path: `${SHOTS}/${name}-4-editeur.png` });

    // traduction : l'anglais est un texte à part, jamais traduit automatiquement
    await page.click('.wd-langs [data-l=en]'); ok(await vis("#a-rev") && /relue/.test(await page.textContent(".wd-langbanner")), "onglet EN : bandeau « traduction relue et validée par un humain »");
    ok((await page.inputValue("#a-title")) === "", "EN : aucun texte traduit automatiquement");
    await page.fill("#a-title", "Elections: the calendar"); await page.click('.wd-langs [data-l=fr]'); ok((await page.inputValue("#a-title")).includes("révisé"), "retour au français : texte d'origine intact");

    await page.reload(); await page.waitForSelector(".hn-ed-prose"); await page.waitForTimeout(300);
    const html2 = await page.evaluate(() => document.querySelector(".hn-ed-prose").innerHTML);
    ok(/Un intertitre/.test(html2) && /figcaption/.test(html2) && /<table/.test(html2) && /noopener/.test(html2) && /text-align: ?center/.test(html2) && (html2.match(/<figure/g) || []).length === 2, "contenu intact après rechargement (nettoyé par le serveur)");
    await openPane(); ok((await page.inputValue("#a-tags")).includes("CEP"), "mots-clés conservés"); await closePane();

    // Aperçu (onglet Affichage)
    await page.click('.wd-tab[data-tab=affichage]'); await page.click(".hn-ed-view-preview"); await page.waitForSelector(".hn-dlg .article-body"); await page.screenshot({ path: `${SHOTS}/${name}-5-apercu.png` });
    await page.click(".hn-dlg >> text=Fermer");

    // Programmation : le texte dit la vérité (aucune vérification automatique n'a eu lieu dans cette base neuve)
    await page.click(".wd-publish"); await page.click('.wd-menuitem:has-text("Programmer")'); await page.waitForSelector(".hn-dlg .hn-sub");
    ok(/Aucune vérification automatique récente/.test(await page.textContent(".hn-dlg .hn-sub")), "fenêtre « Programmer » : " + (await page.textContent(".hn-dlg .hn-sub")).slice(0, 70) + "…");
    await page.click(".hn-dlg >> text=Annuler");

    // Publication (menu « Publier »)
    await page.click(".wd-publish"); await page.click(".wd-menuitem:has-text(\"Publier maintenant\")"); await page.click(".hn-dlg button:has-text(\"Publier\")");
    await page.waitForSelector(".hn-toast"); const toastTxt = await page.textContent(".hn-toast"); ok(/publié/i.test(toastTxt), "publication : " + toastTxt);
    ok(/Publié/.test(await page.textContent(".wd-title .badge")), "badge « Publié »");
    ok(/Publié/.test(await page.textContent(".wd-publish")), "le bouton indique « Publié »");
    await openPane(); await page.click('[data-sec=cor] summary');
    ok(await page.isVisible("text=Publier la correction"), "formulaire de correction affiché pour un article publié"); await closePane();

    // Messages / comptes / stats / compte
    for (const [hash, sel] of [["#/messages", ".empty-state"], ["#/abonnes", ".hn-card"], ["#/stats", ".hn-kpi"], ["#/comptes", ".hn-table"], ["#/compte", "#p-cur"]]) {
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
