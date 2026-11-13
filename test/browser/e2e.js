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
  execFileSync("node", ["build.js"], { cwd: ROOT, env: process.env, stdio: "pipe" }); // dist/ toujours à jour (admin + site) avant les tests
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
    const tabs = await page.$$eval(".hn-tabs a", (a) => a.map((x) => x.textContent)); ok(tabs.length === 15 && tabs[0] === "Tableau de bord", "onglets administrateur : " + tabs.join(", "));
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
    const alertText = () => page.evaluate(() => (document.querySelector(".hn-dlg .hn-alert") || {}).textContent || "");
    const refuse = async (file, re, msg) => {
      await page.setInputFiles("#img-file", file);
      await page.waitForFunction((s) => new RegExp(s).test((document.querySelector(".hn-dlg .hn-alert") || {}).textContent || ""), re.source, { timeout: 8000 });
      ok(true, msg);
    };
    const accept = async (file, msg) => {
      await page.setInputFiles("#img-file", { name: "reset.txt", mimeType: "text/plain", buffer: Buffer.from("x") }).catch(() => {});
      await page.setInputFiles("#img-file", file);
      await page.waitForFunction(() => / px/.test((document.querySelector(".pk-prev p") || {}).textContent || "") && /après réduction/.test(document.querySelector(".pk-prev p").textContent), null, { timeout: 15000 }).catch(async (e) => { console.log("  DIAG", msg, "| alerte :", JSON.stringify(await alertText()), "| aperçu :", JSON.stringify(await page.evaluate(() => (document.querySelector(".pk-prev p") || {}).textContent))); throw e; });
      ok(true, msg + " : " + (await page.textContent(".pk-prev p")));
    };
    await refuse({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("pas une image") }, /n'est pas une image/, "fichier qui n'est pas une image refusé : « Ce fichier n'est pas une image. »");
    await refuse({ name: "logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>") }, /SVG/, "image SVG refusée (sécurité)");
    await refuse({ name: "enorme.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(21 * 1024 * 1024, 1) }, /20 Mo/, "au-delà de 20 Mo : refus clair (« 20 Mo au maximum »)");
    await refuse({ name: "abimee.jpg", mimeType: "image/jpeg", buffer: Buffer.from("ce ne sont pas des pixels") }, /Impossible de lire/, "fichier abîmé : message clair, pas de blocage");
    const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
    const bmp = (w, h) => { const row = Math.ceil((w * 3) / 4) * 4, size = 54 + row * h, b = Buffer.alloc(size); b.fill(0x80, 54); b.write("BM"); b.writeUInt32LE(size, 2); b.writeUInt32LE(54, 10); b.writeUInt32LE(40, 14); b.writeInt32LE(w, 18); b.writeInt32LE(h, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28); b.writeUInt32LE(row * h, 34); return b; };
    await accept({ name: "animation.gif", mimeType: "image/gif", buffer: GIF }, "format GIF accepté");
    await accept({ name: "scan.bmp", mimeType: "image/bmp", buffer: bmp(300, 200) }, "format BMP accepté");
    await accept({ name: "sans-type.gif", mimeType: "", buffer: GIF }, "fichier sans type déclaré accepté (cas fréquent sur Android)");
    // WebView ancien : createImageBitmap absent ou refusant l'option d'orientation → repli sur la balise <img>
    await page.evaluate(() => { window.__cib = window.createImageBitmap; window.createImageBitmap = undefined; });
    await accept({ name: "ancien-webview.bmp", mimeType: "image/bmp", buffer: bmp(120, 80) }, "WebView ancien (sans createImageBitmap) : image lue quand même");
    await page.evaluate(() => { window.createImageBitmap = function (f, o) { if (o) return Promise.reject(new TypeError("valeur d'option non valide")); return window.__cib(f); }; });
    await accept({ name: "option-refusee.bmp", mimeType: "image/bmp", buffer: bmp(120, 80) }, "WebView refusant l'option d'orientation : image lue quand même");
    await page.evaluate(() => { window.createImageBitmap = window.__cib; });
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

    // images du texte : taille, position et déplacement (onglet contextuel « Image »)
    const figs = () => page.locator(".hn-ed-prose figure");
    const hasCls = async (c) => (await figs().first().evaluate((e, k) => e.classList.contains(k), c));
    const widthRatio = () => page.evaluate(() => { const f = document.querySelector(".hn-ed-prose figure"); return f.getBoundingClientRect().width / f.parentElement.getBoundingClientRect().width; });
    const phone = page.viewportSize().width <= 600; // sur téléphone les images sont un peu plus larges et ne flottent pas (texte trop étroit)
    const W = phone ? { s: 0.55, m: 0.75, l: 0.9 } : { s: 0.33, m: 0.5, l: 0.75 };
    await figs().first().click(); await page.waitForTimeout(250);
    ok(await page.locator('.wd-tab[data-tab=image]').evaluate((e) => e.classList.contains("on") && !e.hidden), "image sélectionnée : l'onglet « Image » apparaît et s'ouvre");
    ok((await widthRatio()) > 0.95, "par défaut : pleine largeur");
    await page.click(".hn-ed-fig-s"); await page.waitForTimeout(200);
    let r1 = await widthRatio(); ok((await hasCls("fig-s")) && Math.abs(r1 - W.s) < 0.04, "taille « Petite » (" + r1.toFixed(2) + (phone ? ", téléphone" : " : un tiers de la largeur") + ")");
    await page.click(".hn-ed-fig-l"); await page.waitForTimeout(200);
    r1 = await widthRatio(); ok((await hasCls("fig-l")) && Math.abs(r1 - W.l) < 0.04, "taille « Grande » (" + r1.toFixed(2) + (phone ? ", téléphone" : " : trois quarts de la largeur") + ")");
    await page.click(".hn-ed-fig-left"); await page.waitForTimeout(200);
    ok((await hasCls("fig-left")) && (await figs().first().evaluate((e) => getComputedStyle(e).float)) === (phone ? "none" : "left"), "position « À gauche » : " + (phone ? "classe appliquée (pas d'habillage sur téléphone)" : "l'image flotte, le texte l'entoure"));
    await page.click(".hn-ed-fig-full"); await page.waitForTimeout(200);
    ok(!(await hasCls("fig-left")) && (await widthRatio()) > 0.95, "pleine largeur : plus d'habillage par le texte");
    await page.click(".hn-ed-fig-right"); await page.waitForTimeout(200);
    r1 = await widthRatio(); ok((await hasCls("fig-right")) && (await hasCls("fig-m")) && Math.abs(r1 - W.m) < 0.04, "« À droite » depuis pleine largeur : taille moyenne automatique (" + r1.toFixed(2) + ")");
    // déplacement : l'image du haut descend d'un bloc, puis remonte
    const order = () => page.evaluate(() => Array.from(document.querySelector(".hn-ed-prose").children).map((n) => n.tagName.toLowerCase()).join(","));
    const before = await order();
    ok((await page.locator(".hn-ed-fig-up").isDisabled()) === (before.split(",")[0] === "figure"), "« Monter » grisé seulement si l'image est déjà en premier");
    const alts = () => page.evaluate(() => Array.from(document.querySelectorAll(".hn-ed-prose figure img")).map((i) => i.alt).join("|"));
    const altsBefore = await alts();
    await page.click(".hn-ed-fig-down"); await page.waitForTimeout(200);
    const altsAfter = await alts(); ok(altsAfter !== altsBefore && altsAfter.split("|").length === 2 && (await order()).split(",").length === before.split(",").length, "« Descendre » : l'image passe après l'autre, rien n'est perdu (" + altsBefore + " → " + altsAfter + ")");
    await page.click(".hn-ed-fig-up"); await page.waitForTimeout(200);
    ok((await alts()) === altsBefore && (await order()) === before, "« Monter » : retour à la place d'origine");
    await page.click(".hn-ed-fig-s"); await page.click(".hn-ed-fig-left"); await page.waitForTimeout(200);
    ok((await figs().count()) === 2 && (await hasCls("fig-s")) && (await hasCls("fig-left")), "réglages conservés ; les deux images sont toujours là");
    await page.click('.wd-tab[data-tab=insertion]');

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
    ok(await page.$eval("[data-sec=img]", (e) => e.open), "volet « Image principale (obligatoire) » ouvert d'office tant qu'il n'y a pas d'image");
    ok(/obligatoire/i.test(await page.textContent("[data-sec=img] summary")) && /Image principale obligatoire/.test(await page.textContent("[data-sec=img]")), "l'image principale est signalée comme obligatoire");
    await page.click(".wd-pickmain"); await page.waitForSelector("#img-alt");
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
    ok((await page.locator(".hn-ed-prose figure.fig-s.fig-left").count()) === 1, "taille et position de l'image conservées après enregistrement et rechargement (classes acceptées par le serveur)");
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
