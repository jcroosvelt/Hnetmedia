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
  // Version anglaise : quelques traductions relues (les autres articles n'existent qu'en français)
  await db.query(`INSERT INTO article_translations (article_id, lang, title, excerpt, content, reviewed)
    SELECT id, 'en', 'English story ' || id, 'English summary.', '<p>English text of the story.</p>', true FROM articles WHERE id IN ('tech-id1', 'tech-id2', 'politique-id1')`);
  // Auteur (25 articles = 3 pages) et tag (11 articles = 2 pages)
  await db.query("INSERT INTO authors (id, name, role) VALUES ('jean-test', 'Jean Test', 'Reporter')");
  await db.query("UPDATE articles SET author_id = 'jean-test' WHERE id IN (SELECT id FROM articles WHERE category_slug = 'monde' ORDER BY id LIMIT 25)");
  await db.query("INSERT INTO tags (slug, label) VALUES ('haiti', 'Haïti')");
  await db.query("INSERT INTO article_tags (article_id, tag_slug) SELECT id, 'haiti' FROM articles WHERE category_slug = 'tech'");
  await db.query("INSERT INTO article_tags (article_id, tag_slug) SELECT id, 'haiti' FROM articles WHERE category_slug = 'sport' LIMIT 3");
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
    ok((await page.getAttribute('link[rel=canonical]', "href")) === "https://www.hnetmedia.com/politique/page/2", "canonical propre de la page 2 (sans .html)");
    ok((await page.getAttribute('link[rel=prev]', "href")).endsWith("/politique") && (await page.getAttribute('link[rel=next]', "href")).endsWith("/politique/page/3"), "liens rel prev / next");
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
    // auteurs et tags paginés comme les rubriques
    const gcards = () => page.locator(".news-grid .news-card").count();
    r = await page.goto("/auteur/jean-test"); ok(r.status() === 200 && (await gcards()) === 10 && (await items()).join("|") === "1|2|3|Suivant ›", "auteur, page 1 : 10 articles, barre " + (await items()).join(" | "));
    r = await page.goto("/auteur/jean-test/page/3"); ok(r.status() === 200 && (await gcards()) === 5 && (await items()).join("|") === "‹ Précédent|1|2|3", "auteur, page 3 : 5 derniers");
    ok((await page.getAttribute("link[rel=canonical]", "href")) === "https://www.hnetmedia.com/auteur/jean-test/page/3" && (await page.textContent(".author-name")) === "Jean Test", "auteur, page 3 : canonical et fiche répétée");
    ok((await page.getAttribute("link[rel=prev]", "href")).endsWith("/auteur/jean-test/page/2"), "auteur : rel=prev");
    r = await page.goto("/auteur/jean-test/page/4"); ok(r.status() === 404, "auteur, page 4 inexistante : 404");
    r = await page.goto("/tag/haiti"); ok(r.status() === 200 && (await gcards()) === 10 && (await items()).join("|") === "1|2|Suivant ›", "tag, page 1 : 10 articles (14 au total)");
    await page.click('#catPagination a[aria-label="Page 2"]'); await page.waitForURL(/\/tag\/haiti\/page\/2/);
    ok((await gcards()) === 4 && /page 2/.test(await page.title()), "tag, page 2 par clic : 4 articles, titre " + (await page.title()));
    ok(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), "tag : pas de débordement horizontal");
    // version anglaise : sélecteur de langue, équivalents, recherche, contact
    await page.goto("/"); await page.click('.lang-sw a[hreflang="en"]'); await page.waitForURL(/\/en$/);
    ok((await page.evaluate(() => document.documentElement.lang)) === "en" && (await page.textContent(".nav-link.on")).trim() === "Home", "FR → EN : accueil anglais, menu en anglais");
    ok(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), "accueil anglais : pas de débordement horizontal");
    await page.goto("/en/article/tech-id-article-1"); ok((await page.textContent("h1")).includes("English story tech-id1"), "article anglais : titre anglais");
    await page.click('.lang-sw a[hreflang="fr"]'); await page.waitForURL(/\/article\/tech-id-article-1$/);
    ok((await page.evaluate(() => document.documentElement.lang)) === "fr" && (await page.textContent("h1")).includes("Article de test tech"), "EN → FR : même article en français");
    await page.goto("/article/politique-id-article-5"); ok((await page.getAttribute('.lang-sw a[hreflang="en"]', "href")) === "/en", "article sans version anglaise : le sélecteur mène à l'accueil anglais");
    r = await page.goto("/en/article/politique-id-article-5"); ok(r.status() === 404, "article non traduit : pas de page anglaise");
    await page.goto("/en/recherche?q=English"); await page.waitForSelector("#searchResults .news-card");
    ok((await page.locator("#searchResults .news-card").count()) === 3 && (await page.getAttribute("#searchResults .news-card", "href")).startsWith("/en/article/") && /3 results/.test(await page.textContent("#searchResultCount")), "recherche anglaise : 3 résultats, liens /en/article/…");
    await page.goto("/en/contact"); await page.click("#contactForm button[type=submit]"); await page.waitForSelector("#contactMsg:not([hidden])");
    ok(/Please enter your name/.test(await page.textContent("#contactMsg")), "formulaire de contact anglais : message en anglais");
    ok(errs.length === 0, "aucune erreur JavaScript");
    await ctx.close();
  }
  const sm = fs.readFileSync(path.join(OUT, "sitemap.xml"), "utf8");
  ok(/politique\/page\/2</.test(sm) && /politique\/page\/3</.test(sm) && /monde\/page\/8</.test(sm) && !/sport\/page\//.test(sm), "plan du site : pages 2 et suivantes listées, pas de page fantôme");
  ok(/auteur\/jean-test\/page\/3</.test(sm) && /tag\/haiti\/page\/2</.test(sm) && !/jean-test\/page\/4/.test(sm), "plan du site : pages 2+ des auteurs et des tags");
  ok(!fs.existsSync(path.join(OUT, "politique", "page", "4.html")), "aucun fichier de page vide");
  await browser.close(); server.close(); await require(ROOT + "/server/db").getDb().end();
  fs.rmSync(OUT, { recursive: true, force: true });
})().catch((e) => { console.error("ÉCHEC :", e.message.split("\n").slice(0, 5).join("\n")); process.exit(1); });
