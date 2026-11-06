// Formulaire de contact public : envoi réel, protections, messages honnêtes, mobile + ordinateur.
// À lancer APRÈS test/browser/e2e.js (réutilise sa base et son dist/ ; `node build.js` sur cette base avant).
const ROOT = require("path").join(__dirname, "..", "..");
Object.assign(process.env, { DB_DRIVER: "pg", DATABASE_URL: "postgres://postgres@127.0.0.1:5433/hnet_e2e", HASH_SECRET: "secret-de-test-0123456789abcdef0123456789", SITE_URL: "http://127.0.0.1" });
const { chromium, devices } = require("playwright");
const { start } = require(ROOT + "/test/e2e-server.js");
const { getDb } = require(ROOT + "/server/db.js");
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✘ ") + m); if (!c) process.exitCode = 1; };
(async () => {
  const db = getDb(); await db.query("DELETE FROM contact_messages"); await db.query("DELETE FROM rate_limits");
  const server = await start(ROOT + "/dist"); const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  for (const [name, o] of [["ordinateur", { viewport: { width: 1280, height: 900 } }], ["mobile", devices["Pixel 5"]]]) {
    console.log("— " + name);
    await db.query("DELETE FROM contact_messages"); await db.query("DELETE FROM rate_limits");
    const ctx = await browser.newContext({ ...o, baseURL: base, extraHTTPHeaders: { "x-forwarded-for": name === "mobile" ? "10.9.0.2" : "10.9.0.1" } });
    const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
    await page.goto("/contact"); await page.waitForSelector("#contactForm");
    const opts = await page.$$eval("select[name=category] option", (a) => a.map((x) => x.textContent));
    ok(opts.includes("Droit de réponse") && opts[opts.length - 1] === "Autre", "types de demande issus des réglages : " + opts.slice(1).join(", "));
    const hpBox = await page.locator("input[name=hp]").boundingBox();
    ok(!hpBox || hpBox.x < -1000 || hpBox.width <= 1, "le champ piège est hors écran (invisible pour un humain)");
    ok(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), "pas de débordement horizontal");
    const msg = () => page.textContent("#contactMsg");

    await page.fill("input[name=name]", "Marie Joseph"); await page.fill("input[name=email]", "pas-un-email"); await page.fill("textarea[name=message]", "Bonjour");
    await page.click("#contactForm button[type=submit]"); ok(/email valide/i.test(await msg()), "e-mail invalide : message clair avant tout envoi");

    await page.fill("input[name=email]", "marie@example.org"); await page.selectOption("select[name=category]", "Droit de réponse");
    await page.fill("textarea[name=message]", "Je souhaite exercer mon droit de réponse suite à votre article."); await page.fill("input[name=subject]", "Droit de réponse");
    await page.click("#contactForm button[type=submit]");
    await page.waitForFunction(() => /trop rapide/i.test(document.getElementById("contactMsg").textContent), null, { timeout: 8000 });
    ok(true, "envoi immédiat (< 3 s) refusé honnêtement, sans perte de la saisie : « " + (await msg()).slice(0, 60) + "… »");
    ok((await page.inputValue("textarea[name=message]")).includes("droit de réponse"), "le message saisi est conservé");
    ok((await db.query("SELECT count(*)::int n FROM contact_messages"))[0].n === 0, "rien n'a été enregistré");

    await page.waitForTimeout(3300); await page.click("#contactForm button[type=submit]");
    await page.waitForFunction(() => /bien été reçu/i.test(document.getElementById("contactMsg").textContent), null, { timeout: 8000 });
    ok(true, "envoi réel : « " + (await msg()) + " »");
    ok((await page.inputValue("input[name=name]")) === "", "formulaire vidé après succès");
    const rows = await db.query("SELECT name, email, category, subject, status, ip_hash FROM contact_messages ORDER BY created_at DESC");
    ok(rows.length === 1 && rows[0].category === "Droit de réponse" && rows[0].status === "nouveau" && rows[0].email === "marie@example.org", "message enregistré dans la base (statut « nouveau »)");
    ok(rows[0].ip_hash && !rows[0].ip_hash.includes("10.9"), "adresse IP jamais stockée en clair");

    // robot : champ piège rempli
    await page.fill("input[name=name]", "Robot"); await page.fill("input[name=email]", "bot@example.org"); await page.selectOption("select[name=category]", "Autre"); await page.fill("textarea[name=message]", "Achetez nos produits miracles maintenant !");
    await page.evaluate(() => { document.querySelector("input[name=hp]").value = "http://spam"; });
    await page.waitForTimeout(3300); await page.click("#contactForm button[type=submit]");
    await page.waitForFunction(() => /refusé/i.test(document.getElementById("contactMsg").textContent), null, { timeout: 8000 });
    ok((await db.query("SELECT count(*)::int n FROM contact_messages"))[0].n === 1, "champ piège rempli : envoi refusé, rien enregistré");
    ok(errs.length === 0, "aucune erreur JavaScript");
    await page.screenshot({ path: `${require("os").tmpdir()}/contact-${name}.png`, fullPage: true });
    await ctx.close();
  }
  await browser.close(); server.close(); await db.end();
})().catch((e) => { console.error("ÉCHEC :", e.message.split("\n").slice(0, 4).join("\n")); process.exit(1); });
