// Barre de recherche : loupe cliquable, en-tête complet de 320 à 1280 px, résultats. À lancer APRÈS test/browser/e2e.js (réutilise sa base et son dist/).
const ROOT = require("path").join(__dirname, "..", "..");
Object.assign(process.env, { DB_DRIVER: "pg", DATABASE_URL: "postgres://postgres@127.0.0.1:5433/hnet_e2e", HASH_SECRET: "secret-de-test-0123456789abcdef0123456789", SITE_URL: "http://127.0.0.1" });
const { chromium, devices } = require("playwright");
const { start } = require(ROOT + "/test/e2e-server.js");
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✘ ") + m); if (!c) process.exitCode = 1; };
(async () => {
  const server = await start(ROOT + "/dist"); const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  console.log("— Largeurs d'écran : l'en-tête doit rester entièrement visible");
  for (const w of [320, 360, 393, 480, 600, 700, 701, 768, 900, 1100, 1280]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 700 }, baseURL: base, hasTouch: w < 800, isMobile: w < 800 }); const page = await ctx.newPage();
    await page.goto("/"); await page.waitForSelector("#searchInput");
    const r = await page.evaluate(() => { const q = (s) => document.querySelector(s).getBoundingClientRect();
      const items = [".logo-link", ".search-box", ".lang-sw"].map((s) => q(s)); const sub = getComputedStyle(document.querySelector(".sub-btn")).display !== "none" ? q(".sub-btn") : null;
      const maxRight = Math.max(...items.map((b) => b.right), sub ? sub.right : 0);
      return { maxRight: Math.round(maxRight), champ: Math.round(q("#searchInput").width), W: innerWidth, deborde: document.documentElement.scrollWidth > innerWidth, chevauche: q(".logo-link").right > q(".search-box").left + 1 }; });
    ok(r.maxRight <= r.W && !r.deborde && !r.chevauche && r.champ >= 90, `${w}px : bord droit ${r.maxRight} ≤ ${r.W}, champ de recherche ${r.champ}px, pas de chevauchement`);
    await ctx.close();
  }
  console.log("— Fonctionnement");
  for (const [name, o] of [["ordinateur", { viewport: { width: 1280, height: 800 } }], ["mobile", devices["Pixel 5"]]]) {
    const ctx = await browser.newContext({ ...o, baseURL: base }); const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
    await page.goto("/"); await page.fill("#searchInput", "calendrier");
    const box = await page.locator(".search-icon").boundingBox(); await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForURL(/recherche\?q=calendrier/, { timeout: 5000 }).catch(() => {});
    ok(/recherche\?q=calendrier/.test(page.url()), `${name} : un clic sur la loupe lance la recherche`);
    await page.waitForSelector("#searchResults .news-card"); ok(/2 résultat/.test(await page.textContent("#searchResultCount")), `${name} : résultats affichés (${await page.textContent("#searchResultCount")})`);
    ok((await page.inputValue("#searchQ")) === "calendrier", `${name} : le mot cherché est repris sur la page de résultats`);
    await page.goto("/"); await page.press("#searchInput", "Enter"); await page.waitForTimeout(500);
    ok(/\/$|recherche/.test(page.url()), `${name} : recherche vide → pas d'erreur`);
    await page.goto("/"); await page.fill("#searchInput", "ÉLECTIONS"); await page.press("#searchInput", "Enter"); await page.waitForSelector("#searchResults .news-card");
    ok(true, `${name} : insensible aux majuscules et aux accents`);
    await page.fill("#searchQ", "zzzintrouvable"); await page.waitForSelector("#searchResults .empty-state"); ok(/Aucun résultat/.test(await page.textContent("#searchResults")), `${name} : « Aucun résultat » honnête`);
    ok(errs.length === 0, `${name} : aucune erreur JavaScript`);
    await page.screenshot({ path: `${require("os").tmpdir()}/s2-${name}-resultats.png` });
    await ctx.close();
  }
  for (const w of [360, 393]) { const ctx = await browser.newContext({ viewport: { width: w, height: 700 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, baseURL: base }); const page = await ctx.newPage(); await page.goto("/"); await page.waitForSelector("#searchInput"); await page.screenshot({ path: `${require("os").tmpdir()}/s2-en-tete-${w}.png`, clip: { x: 0, y: 0, width: w, height: 190 } }); await ctx.close(); }
  await browser.close(); server.close(); await require(ROOT + "/server/db").getDb().end();
})().catch((e) => { console.error("ÉCHEC :", e.message.split("\n")[0]); process.exit(1); });
