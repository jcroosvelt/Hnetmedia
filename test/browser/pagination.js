// Pagination des rubriques (10 par page) : liens réels, navigation clavier, mobile, plan du site.
// Base de test dédiée (hnet_pag) remplie de FAUX articles de test — jamais Neon. Sortie de build à part (BUILD_OUT).
const ROOT = require("path").join(__dirname, "..", "..");
const os = require("os"), path = require("path"), fs = require("fs");
const { execFileSync } = require("child_process");
const { Client } = require("pg");
const OUT = path.join(os.tmpdir(), "hnet-pagination-dist");
const URL_DB = "postgres://postgres@127.0.0.1:5433/hnet_pag";
Object.assign(process.env, { DB_DRIVER: "pg", DATABASE_URL: URL_DB, HASH_SECRET: "secret-de-test-0123456789abcdef0123456789", SITE_URL: "https://www.hnetmedia.com" });
const { chromium, devices } = require("playwright");
const { start } = require(ROOT + "/test/e2e-server.js");
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✘ ") + m); if (!c) process.exitCode = 1; };
(async () => {
  const adm = new Client({ connectionString: "postgres://postgres@127.0.0.1:5433/postgres" }); await adm.connect();
  await adm.query("DROP DATABASE IF EXISTS hnet_pag WITH (FORCE)"); await adm.query("CREATE DATABASE hnet_pag"); await adm.end();
  execFileSync("node", ["db/migrate.js"], { cwd: ROOT, env: process.env, stdio: "pipe" });
  const db = new Client({ connectionString: URL_DB }); await db.connect();
  const seed = async (cat, n) => {
    await db.query(`INSERT INTO articles (id, slug, status, category_slug, author_name, published_at)
      SELECT $1 || g, $1 || '-article-' || g, 'publie', $2, 'Rédaction', now() - (g || ' hours')::interval FROM generate_series(1, $3) g`, [cat + "-id", cat, n]);
    await db.query(`INSERT INTO article_translations (article_id, lang, title, excerpt, content, reviewed)
      SELECT $1 || g, 'fr', 'Article de test ' || $2 || ' n° ' || g, 'Chapeau de test.', '<p>Texte de test.</p>', true FROM generate_series(1, $3) g`, [cat + "-id", cat, n]);
  };
  await seed("politique", 25); await seed("sport", 3); await seed("monde", 75); await seed("culture", 10); await seed("tech", 11);
  await db.end();
  execFileSync("node", ["build.js"], { cwd: ROOT, env: { ...process.env, BUILD_OUT: OUT }, stdio: "pipe" });
  const server = await start(OUT); const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  for (const [name, o] of [["ordinateur", { viewport: { width: 1280, height: 900 } }], ["mobile 360", { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true }]]) {
    console.log("— " + name);
    const ctx = await browser.newContext({ ...o, baseURL: base }); const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
    const cards = () => page.locator("#catGrid .news-card").count();
    const items = () => page.$$eval("#catPagination > *", (a) => a.map((x) => x.textContent.trim()));
    let r = await page.goto("/politique"); ok(r.status() === 200 && (await cards()) === 10, "page 1 : 10 articles");
    ok((await items()).join("|") === "1|2|3|Suivant ›", "barre : " + (await items()).join(" | "));
    ok((await page.getAttribute("#catPagination a.active", "aria-current")) === "page", "page actuelle signalée (aria-current)");
    ok(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), "pas de débordement horizontal");
    r = await page.goto("/politique/page/2"); ok(r.status() === 200 && (await cards()) === 10, "page 2 : 10 articles");
    ok((await items()).join("|") === "‹ Précédent|1|2|3|Suivant ›", "barre : " + (await items()).join(" | "));
    ok((await page.getAttribute('link[rel=canonical]', "href")) === "https://www.hnetmedia.com/politique/page/2.html", "canonical de la page 2");
    ok((await page.getAttribute('link[rel=prev]', "href")).endsWith("/politique.html") && (await page.getAttribute('link[rel=next]', "href")).endsWith("/politique/page/3.html"), "liens rel prev / next");
    ok(/page 2/.test(await page.title()), "titre : " + (await page.title()));
    const first = await page.textContent("#catGrid .news-card .nc-title"); await page.goto("/politique");
    ok(first !== (await page.textContent("#catGrid .news-card .nc-title")), "la page 2 montre d'autres articles que la page 1");
    r = await page.goto("/politique/page/3"); ok((await cards()) === 5 && (await items()).join("|") === "‹ Précédent|1|2|3", "page 3 : 5 derniers articles, pas de « Suivant »");
    r = await page.goto("/politique/page/4"); ok(r.status() === 404, "page 4 inexistante : 404");
    // clavier
    await page.goto("/politique"); await page.focus('#catPagination a[aria-label="Page 2"]'); await page.keyboard.press("Enter"); await page.waitForURL(/\/politique\/page\/2/);
    ok(true, "navigation au clavier (Tab/Entrée) vers la page 2");
    // petites rubriques
    await page.goto("/sport"); ok((await cards()) === 3 && (await page.locator("#catPagination").count()) === 0, "3 articles : pas de pagination");
    await page.goto("/culture"); ok((await cards()) === 10 && (await page.locator("#catPagination").count()) === 0, "exactement 10 articles : une seule page, pas de pagination");
    await page.goto("/tech"); ok((await cards()) === 10 && (await items()).join("|") === "1|2|Suivant ›", "11 articles : 2 pages");
    r = await page.goto("/tech/page/2"); ok((await cards()) === 1, "page 2 : le 11e article seul");
    // beaucoup de pages : points de suspension
    await page.goto("/monde/page/4"); const it = (await items()).join("|");
    ok(it === "‹ Précédent|1|…|3|4|5|…|8|Suivant ›", "75 articles, page 4 : " + it);
    const box = await page.locator("#catPagination").boundingBox(); ok(box.x >= 0 && box.x + box.width <= o.viewport.width + 1, `la barre tient dans l'écran (${Math.round(box.width)} px sur ${o.viewport.width})`);
    ok(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), "pas de débordement horizontal (barre longue)");
    await page.locator("#catPagination").scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(os.tmpdir(), `pagination-${name.split(" ")[0]}.png`) });
    await page.goto("/monde/page/8"); ok((await cards()) === 5, "dernière page : 5 articles");
    ok(errs.length === 0, "aucune erreur JavaScript");
    await ctx.close();
  }
  const sm = fs.readFileSync(path.join(OUT, "sitemap.xml"), "utf8");
  ok(/politique\/page\/2\.html/.test(sm) && /politique\/page\/3\.html/.test(sm) && /monde\/page\/8\.html/.test(sm) && !/sport\/page\//.test(sm), "plan du site : pages 2 et suivantes listées, pas de page fantôme");
  ok(!fs.existsSync(path.join(OUT, "politique", "page", "4.html")), "aucun fichier de page vide");
  await browser.close(); server.close(); await require(ROOT + "/server/db").getDb().end();
  fs.rmSync(OUT, { recursive: true, force: true });
})().catch((e) => { console.error("ÉCHEC :", e.message.split("\n").slice(0, 5).join("\n")); process.exit(1); });
