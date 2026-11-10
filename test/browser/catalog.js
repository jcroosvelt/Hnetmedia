// Écrans Médias, Équipe, Partenaires, Offres, Réglages — ordinateur + mobile, base locale (jamais Neon).
// À lancer APRÈS test/browser/e2e.js (réutilise la base hnet_e2e).
const ROOT = require("path").join(__dirname, "..", "..");
Object.assign(process.env, { DB_DRIVER: "pg", DATABASE_URL: "postgres://postgres@127.0.0.1:5433/hnet_e2e", HASH_SECRET: "secret-de-test-0123456789abcdef0123456789", SITE_URL: "http://127.0.0.1" });
const { chromium, devices } = require("playwright");
const { start } = require(ROOT + "/test/e2e-server.js");
const { hashPassword } = require(ROOT + "/server/auth.js");
const { getDb } = require(ROOT + "/server/db.js");
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✘ ") + m); if (!c) process.exitCode = 1; };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
(async () => {
  const db = getDb(); const pw = "mot de passe de test 2026";
  await db.query("INSERT INTO users (email, display_name, password_hash, role_id) SELECT 'cat-admin@h.com','Admin test',$1,id FROM roles WHERE code='administrateur' ON CONFLICT DO NOTHING", [await hashPassword(pw)]);
  const server = await start(ROOT + "/dist"); const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  for (const [name, o] of [["ordinateur", { viewport: { width: 1280, height: 900 } }], ["mobile", devices["Pixel 5"]]]) {
    console.log("— " + name);
    const ctx = await browser.newContext({ ...o, baseURL: base }); const page = await ctx.newPage(); const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await page.goto("/admin"); await page.fill("#l-email", "cat-admin@h.com"); await page.fill("#l-pw", pw); await page.click("button[type=submit]"); await page.waitForSelector(".hn-tabs a");
    const tabs = await page.$$eval(".hn-tabs a", (a) => a.map((x) => x.textContent));
    ok(["Médias", "Équipe", "Partenaires", "Offres d'emploi", "Pages du site", "Réglages", "Comptes"].every((t) => tabs.includes(t)), "onglets : " + tabs.join(", "));
    const go = async (label) => { await page.click(`.hn-tabs a:has-text("${label}")`); await page.waitForSelector(".hn-h1"); };
    const noOverflow = async (m) => ok(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), "pas de débordement horizontal : " + m);
    const dlg = async (fields) => { for (const [k, v] of Object.entries(fields)) await page.fill("#dlg-" + k, v); await page.click(".hn-dlg button[type=submit]"); };
    const tag = name; // noms uniques par passage

    // Équipe
    await go("Équipe"); await page.click("text=+ Nouvelle fiche");
    await dlg({ name: "Fiche " + tag, role: "Reporter", bio: "Présentation réelle.", facebook: "https://facebook.com/x" });
    await page.waitForSelector(`td:has-text("Fiche ${tag}")`); ok(true, "fiche d'équipe créée"); await noOverflow("équipe");
    ok(await page.isVisible(`tr:has-text("Fiche ${tag}") button:has-text("Photo")`), "bouton Photo disponible");
    await page.click(`tr:has-text("Fiche ${tag}") button:has-text("Supprimer")`); await page.click(".hn-dlg .hn-btn-danger"); await page.waitForSelector(`td:has-text("Fiche ${tag}")`, { state: "detached" }); ok(true, "fiche supprimée");

    // Partenaires
    await go("Partenaires"); await page.click("text=+ Nouveau partenaire");
    await dlg({ name: "Partenaire " + tag, url: "http://pas-https.example" });
    await page.waitForSelector('.hn-toast.err:has-text("https")'); ok(true, "lien non https refusé avec un message clair");
    await page.click("text=+ Nouveau partenaire"); await dlg({ name: "Partenaire " + tag, url: "https://partenaire.example", description: "Soutien réel" });
    await page.waitForSelector(`td:has-text("Partenaire ${tag}")`); ok(true, "partenaire créé"); await noOverflow("partenaires");
    await page.click(`tr:has-text("Partenaire ${tag}") button:has-text("Modifier")`); await page.selectOption("#dlg-active", "0"); await page.click(".hn-dlg button[type=submit]");
    await page.waitForSelector(`tr:has-text("Partenaire ${tag}") td[data-l="Visible"]:has-text("Non")`); ok(true, "partenaire masqué (modification + liste mise à jour)");
    await page.click(`tr:has-text("Partenaire ${tag}") button:has-text("Supprimer")`); await page.click(".hn-dlg .hn-btn-danger"); await page.waitForSelector(`td:has-text("Partenaire ${tag}")`, { state: "detached" });

    // Offres
    await go("Offres d'emploi"); await page.click("text=+ Nouvelle offre");
    await page.selectOption("#dlg-status", "ouvert"); await dlg({ title: "Offre " + tag, description: "Description du poste." });
    await page.waitForSelector('.hn-toast.err:has-text("postuler")'); ok(true, "offre « ouverte » sans moyen de postuler refusée");
    await page.click("text=+ Nouvelle offre"); await page.selectOption("#dlg-status", "ouvert");
    await dlg({ title: "Offre " + tag, description: "Description du poste.", applyEmail: "recrutement@exemple.test", contract: "CDD", location: "Pétion-Ville", closesAt: "2099-12-31" });
    await page.waitForSelector(`td:has-text("Offre ${tag}")`); ok(await page.isVisible(`tr:has-text("Offre ${tag}") td[data-l="Statut"]:has-text("Ouvert")`), "offre ouverte créée"); await noOverflow("offres");
    await page.click(`tr:has-text("Offre ${tag}") button:has-text("Supprimer")`); await page.click(".hn-dlg .hn-btn-danger"); await page.waitForSelector(`td:has-text("Offre ${tag}")`, { state: "detached" });

    // Médias (image insérée directement : le téléversement est déjà couvert par e2e.js / roles.js)
    const id = require("crypto").randomUUID(); const uid = (await db.query("SELECT id FROM users WHERE email='cat-admin@h.com'"))[0].id;
    await db.query("INSERT INTO media (id, url, alt, mime_type, width, height, size_bytes, uploaded_by) VALUES ($1,$2,'',$3,1,1,$4,$5)", [id, "/media/" + id, "image/png", PNG.length, uid]);
    await db.query("INSERT INTO media_files (media_id, data) VALUES ($1, $2)", [id, PNG]);
    await go("Médias"); await page.waitForSelector(`img[src="/media/${id}"]`);
    ok(await page.isVisible('td[data-l="Utilisation"]:has-text("Inutilisée")'), "image inutilisée signalée"); await noOverflow("médias");
    await page.click("tr:has(img[src='/media/" + id + "']) button:has-text('Supprimer')"); await page.click(".hn-dlg .hn-btn-danger");
    await page.waitForSelector(`img[src="/media/${id}"]`, { state: "detached" }); ok((await db.query("SELECT 1 FROM media_files WHERE media_id=$1", [id])).length === 0, "image supprimée de la base");

    // Pages fixes : texte d'origine repris dans l'éditeur, modification, retour à l'original
    await go("Pages du site"); await page.waitForSelector('td[data-l="État"]'); await page.waitForFunction(() => document.querySelectorAll('td[data-l="État"]').length === 6);
    ok((await page.locator("tbody tr").count()) === 6 && (await page.locator('td[data-l="État"]:has-text("Texte d\'origine")').count()) === 6, "6 pages fixes, toutes au texte d'origine"); await noOverflow("pages");
    await page.click('tr:has-text("/a-propos") a:has-text("Modifier")'); await page.waitForSelector("#pg-editor .ProseMirror");
    ok((await page.inputValue("#pg-title")) === "Qui sommes-nous ?" && /Notre mission/.test(await page.textContent("#pg-editor .ProseMirror")), "l'éditeur reprend le texte d'origine de la page");
    await page.fill("#pg-title", "À propos " + tag); await page.click("#pg-editor .ProseMirror"); await page.keyboard.press("Control+End"); await page.keyboard.type(" Phrase ajoutée par le test " + tag + ".");
    await page.click(".wd-save"); await page.waitForSelector('.hn-toast:has-text("Page enregistrée")'); ok(true, "page enregistrée");
    await page.reload(); await page.waitForSelector("#pg-editor .ProseMirror");
    ok((await page.inputValue("#pg-title")) === "À propos " + tag && (await page.textContent("#pg-editor .ProseMirror")).includes("Phrase ajoutée par le test " + tag), "modification conservée après rechargement");
    await page.click(".wd-tbtn:has-text(\"Rétablir l'original\")"); await page.click(".hn-dlg .hn-btn-danger"); await page.waitForSelector('td[data-l="État"]');
    ok((await page.locator('td[data-l="État"]:has-text("Modifiée")').count()) === 0, "texte d'origine rétabli");

    // Réglages
    await go("Réglages"); await noOverflow("réglages");
    await page.fill("#s-soc-facebook", "https://facebook.com/hnetmedia-" + tag); await page.fill("#s-leg-director", "Directeur " + tag); await page.fill("#s-footerText", "Pied de page " + tag);
    await page.fill("#s-soc-twitter", "http://pas-https.example"); await page.click("button[type=submit]:has-text('Enregistrer')");
    await page.waitForSelector(".hn-alert:not([hidden])"); ok(/https/.test(await page.textContent(".hn-alert:not([hidden])")), "réseau non https refusé");
    await page.fill("#s-soc-twitter", ""); await page.click("button[type=submit]:has-text('Enregistrer')");
    await page.waitForSelector(".hn-toast:not(.err)"); ok(true, "réglages enregistrés");
    await page.reload(); await page.waitForSelector("#s-soc-facebook");
    ok((await page.inputValue("#s-soc-facebook")) === "https://facebook.com/hnetmedia-" + tag && (await page.inputValue("#s-leg-director")) === "Directeur " + tag && (await page.inputValue("#s-footerText")) === "Pied de page " + tag, "valeurs conservées après rechargement (dont le texte du pied de page)");
    ok(errs.length === 0, "aucune erreur JavaScript " + errs.join(" | "));
    await ctx.close();
  }
  await browser.close(); server.close(); await db.end();
})().catch((e) => { console.error("ÉCHEC :", e.message.split("\n").slice(0, 6).join("\n")); process.exit(1); });
