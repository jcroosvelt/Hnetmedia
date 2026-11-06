#!/usr/bin/env node
/**
 * HNet Media — build.js
 * ─────────────────────────────────────────────────────────
 * Générateur de site statique "maison". Lit le contenu PUBLIC
 * dans Neon (articles publiés, rubriques, auteurs, réglages…) et
 * génère le site multi-pages complet dans /dist : vraies URLs,
 * données structurées, sitemap.xml et rss.xml réels.
 *
 * Usage :  node build.js        (DATABASE_URL requise : voir .env.example)
 *
 * Aucun article en brouillon, programmé ou archivé n'est lu.
 * Sur Vercel, un nouveau build est déclenché à chaque publication.
 * ─────────────────────────────────────────────────────────
 */
"use strict";
const fs = require("fs");
const path = require("path");
require("./server/env")(); // charge .env.local en local (sans effet sur Vercel)
const { loadContent } = require("./server/content");
const { jsonForHtml } = require("./server/html");

const ROOT = __dirname;
const PAGES_DIR = path.join(ROOT, "pages");
const PARTIALS_DIR = path.join(ROOT, "partials");
const DIST_DIR = path.join(ROOT, "dist");

/* ── UTILITAIRES ── */
function readFile(p) {
  return fs.readFileSync(p, "utf8");
}
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}
function writeFile(relPath, content) {
  const full = path.join(DIST_DIR, relPath);
  ensureDir(path.dirname(full));
  fs.writeFileSync(full, content, "utf8");
}
function copyDir(src, dest) {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}
function escAttr(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
function stripTags(html) {
  return String(html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
function estimateReadingTime(html) {
  const words = stripTags(html).split(" ").filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}
function formatDateFR(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}
function formatDateTimeFR(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) +
    " à " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

/* ── CONTENU (lu dans Neon avant la génération, voir init()) ── */
let settings, categories, authors, allArticles, catBySlug, authorById, publishedArticles, BASE_URL;
let headerHtml, footerHtml, orgLd, websiteLd;
const NOW = new Date();

function init(content) {
  settings = content.settings;
  categories = content.categories;
  authors = content.authors;
  allArticles = content.articles;

  catBySlug = Object.fromEntries(categories.map((c) => [c.slug, c]));
  authorById = Object.fromEntries(authors.map((a) => [a.id, a]));

  publishedArticles = allArticles
    .filter((a) => a.status === "publie" && (!a.publishedAt || new Date(a.publishedAt) <= NOW))
    .map((a) => ({
      ...a,
      readingTime: a.readingTime || estimateReadingTime(a.content),
      author: a.authorId ? authorById[a.authorId] : (a.authorName ? { name: a.authorName } : null),
    }))
    .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));

  if (!publishedArticles.length) {
    console.log("ℹ️  Aucun article publié pour le moment. Le site affichera des états vides professionnels — comportement attendu tant qu'aucun article n'est publié dans /admin.");
  }

  BASE_URL = settings.baseUrl.replace(/\/$/, "");

  /* ── PARTIELS ── */
  headerHtml = readFile(path.join(PARTIALS_DIR, "header.html"));
  footerHtml = readFile(path.join(PARTIALS_DIR, "footer.html"));

  // Ticker : alimenté par les articles marqués "urgent" ; sinon message neutre honnête.
  const urgentArticles = publishedArticles.filter((a) => a.urgent);
  const tickerItems = urgentArticles.length
    ? urgentArticles.map((a) => `<a href="/article/${a.slug}.html" class="ticker-item">◆ ${escAttr(a.title)}</a>`).join("")
    : `<span class="ticker-item">◆ Bienvenue sur HNet Media — aucune alerte urgente pour le moment</span>`;
  headerHtml = headerHtml.replace("<!--TICKER_ITEMS-->", tickerItems + tickerItems); // dupliqué pour un défilement continu

  orgLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: settings.siteName,
    url: BASE_URL,
    logo: BASE_URL + "/icon-512.png",
  };
  websiteLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: settings.siteName,
    url: BASE_URL,
    potentialAction: {
      "@type": "SearchAction",
      target: `${BASE_URL}/recherche.html?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

/* ── SQUELETTE DE PAGE ── */
function wrapPage({ title, description, canonicalPath, ogImage, bodyHtml, structuredData = [], noindex = false, extraHead = "" }) {
  const canonical = `${BASE_URL}${canonicalPath}`;
  const jsonLd = structuredData.map((obj) => `<script type="application/ld+json">${jsonForHtml(obj)}</script>`).join("\n");
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escAttr(title)}</title>
<meta name="description" content="${escAttr(description)}">
${noindex ? '<meta name="robots" content="noindex, nofollow">' : '<meta name="robots" content="index, follow">'}
<link rel="canonical" href="${canonical}">
<meta name="theme-color" content="#0A1F44">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escAttr(settings.siteName)}">
<meta property="og:title" content="${escAttr(title)}">
<meta property="og:description" content="${escAttr(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${ogImage || BASE_URL + "/icon-512.png"}">
<meta property="og:locale" content="fr_FR">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escAttr(title)}">
<meta name="twitter:description" content="${escAttr(description)}">
<link rel="alternate" type="application/rss+xml" title="${escAttr(settings.siteName)}" href="/rss.xml">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png">
<link rel="alternate icon" href="/favicon.ico">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400;1,700&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/style.css">
${jsonLd}
${extraHead}
</head>
<body>
${headerHtml}
${bodyHtml}
${footerHtml}
<script src="/assets/main.js" defer></script>
<script src="/assets/contact.js" defer></script>
<script src="/assets/newsletter.js" defer></script>
</body>
</html>`;
}

/* ── COMPOSANTS RÉUTILISABLES ── */
function emptyState(icon, title, text) {
  return `<div class="empty-state"><div class="es-icon">${icon}</div><h3>${escAttr(title)}</h3><p>${text}</p></div>`;
}

function articleBadges(a) {
  let b = "";
  if (a.urgent) b += `<span class="badge badge-urgent">Urgent</span> `;
  if (a.sponsored) b += `<span class="badge badge-sponsored">Sponsorisé</span> `;
  if (a.type === "tribune") b += `<span class="badge badge-tribune">Tribune</span> `;
  if (a.type === "editorial") b += `<span class="badge badge-editorial">Éditorial</span> `;
  if (a.type === "analyse") b += `<span class="badge badge-analyse">Analyse</span> `;
  if (a.type === "opinion") b += `<span class="badge badge-opinion">Opinion</span> `;
  return b;
}

function newsCard(a) {
  const cat = catBySlug[a.category] || { label: a.category, tagClass: "tag", color: "#0A1F44" };
  const bg = a.mainImage && a.mainImage.url
    ? `url('${escAttr(a.mainImage.url)}') center/cover`
    : `linear-gradient(135deg,#0A1F44,${cat.color})`;
  return `
  <a class="news-card reveal" href="/article/${a.slug}.html">
    <div class="nc-img">
      <div class="nc-img-bg" style="background:${bg};height:100%"></div>
      <span class="${cat.tagClass} nc-badge">${escAttr(cat.label)}</span>
    </div>
    <h3 class="nc-title">${escAttr(a.title)}</h3>
    <p class="nc-excerpt">${escAttr(a.excerpt)}</p>
    <div class="nc-foot"><span class="nc-author">${escAttr(a.author ? a.author.name : "Rédaction")}</span><span>·</span><span>${formatDateFR(a.publishedAt)} · ${a.readingTime} min</span></div>
  </a>`;
}

function breadcrumbLd(items) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: BASE_URL + it.path,
    })),
  };
}

/* ══════════════════════════════════════════════
   1) PAGE D'ACCUEIL
   ══════════════════════════════════════════════ */
function buildHome() {
  const featured = publishedArticles.find((a) => a.featured) || publishedArticles[0];
  const side = publishedArticles.filter((a) => a !== featured).slice(0, 4);
  const latest = publishedArticles.slice(0, 9);
  const opinions = publishedArticles.filter((a) => a.category === "opinions").slice(0, 4);

  let heroHtml;
  if (featured) {
    const cat = catBySlug[featured.category] || { label: featured.category, color: "#0A1F44" };
    const bg = featured.mainImage && featured.mainImage.url
      ? `url('${escAttr(featured.mainImage.url)}') center/cover`
      : `linear-gradient(135deg,#0A1F44,${cat.color})`;
    heroHtml = `
    <div class="hero">
      <a class="hero-main" href="/article/${featured.slug}.html" style="background:${bg};display:block;text-decoration:none">
        <div class="hero-overlay">
          <span class="tag">${escAttr(cat.label)}</span>
          <h1 class="hero-title">${escAttr(featured.title)}</h1>
          <p class="hero-sub">${escAttr(featured.excerpt)}</p>
          <div class="hero-meta"><strong>${escAttr(featured.author ? featured.author.name : "Rédaction")}</strong><span>${formatDateFR(featured.publishedAt)}</span><span>${featured.readingTime} min</span></div>
          <span class="hero-read">Lire l'article →</span>
        </div>
      </a>
      <div class="hero-side">
        ${side.map((a) => {
          const c = catBySlug[a.category] || { label: a.category, color: "#0A1F44" };
          const bg2 = a.mainImage && a.mainImage.url ? `url('${escAttr(a.mainImage.url)}') center/cover` : `linear-gradient(135deg,#0A1F44,${c.color})`;
          return `<a class="side-art" href="/article/${a.slug}.html">
            <div class="sa-thumb" style="background:${bg2}"></div>
            <div><span class="sa-cat">${escAttr(c.label)}</span><h4 class="sa-title">${escAttr(a.title)}</h4>
            <div class="sa-meta">${escAttr(a.author ? a.author.name : "Rédaction")} · ${formatDateFR(a.publishedAt)}</div></div>
          </a>`;
        }).join("")}
      </div>
    </div>`;
  } else {
    heroHtml = `<div class="hero">${emptyState("📰", "Aucun article publié pour le moment", "La une s'affichera automatiquement dès qu'un premier article sera publié.")}</div>`;
  }

  const latestHtml = latest.length
    ? `<div class="news-grid">${latest.map(newsCard).join("")}</div>`
    : emptyState("📰", "Aucune actualité récente", "Les derniers articles publiés apparaîtront ici.");

  const catSectionsHtml = categories
    .filter((c) => c.slug !== "opinions")
    .map((c) => {
      const arts = publishedArticles.filter((a) => a.category === c.slug).slice(0, 3);
      return `
      <div class="sec-head">
        <div class="sec-label">${c.icon} ${escAttr(c.label)}</div>
        <div class="sec-rule"></div>
        <a href="/${c.slug}.html" class="sec-more">Tout voir →</a>
      </div>
      ${arts.length ? `<div class="news-grid">${arts.map(newsCard).join("")}</div>` : emptyState(c.icon, `Aucun article ${c.label.toLowerCase()} pour le moment`, "Cette rubrique s'alimentera automatiquement dès qu'un article y sera publié.")}
      `;
    }).join("");

  const opinionsHtml = opinions.length
    ? `<div class="op-grid">${opinions.map((a) => `
      <a class="op-card reveal" href="/article/${a.slug}.html">
        <div class="op-av">${escAttr((a.author ? a.author.name : "R").charAt(0))}</div>
        <div class="op-name">${escAttr(a.author ? a.author.name : "Rédaction")}</div>
        <div class="op-role">${articleBadges(a) || "Contributeur"}</div>
        <p class="op-title">${escAttr(a.title)}</p>
      </a>`).join("")}</div>`
    : emptyState("✍️", "Aucune tribune publiée pour le moment", `Retrouvez bientôt des tribunes et analyses dans <a href="/opinions.html">Opinions &amp; Analyses</a>.`);

  const body = `
  <main>
  <div class="wrap">
    ${heroHtml}
    <div class="sec-head" style="margin-top:40px"><div class="sec-label">Dernières nouvelles</div><div class="sec-rule"></div></div>
    ${latestHtml}
    ${catSectionsHtml}
    <div class="sec-head"><div class="sec-label">✍️ Opinions &amp; Analyses</div><div class="sec-rule"></div><a href="/opinions.html" class="sec-more">Tout voir →</a></div>
    ${opinionsHtml}
    <div class="sec-head"><div class="sec-label">Les plus lus</div><div class="sec-rule"></div></div>
    ${emptyState("📊", "Classement à venir", "Ce classement s'activera automatiquement dès qu'un système de mesure d'audience réel sera connecté au site.")}
  </div>
  </main>`;

  writeFile("index.html", wrapPage({
    title: `${settings.siteName} – ${settings.tagline}`,
    description: settings.description,
    canonicalPath: "/",
    bodyHtml: body,
    structuredData: [orgLd, websiteLd],
  }));
}

/* ══════════════════════════════════════════════
   2) PAGES DE RUBRIQUES
   ══════════════════════════════════════════════ */
function buildCategoryPages() {
  categories.forEach((c) => {
    const arts = publishedArticles.filter((a) => a.category === c.slug);
    const gridHtml = arts.length
      ? `<div class="news-grid" id="catGrid">${arts.map(newsCard).join("")}</div>
         <div class="pagination" id="catPagination" hidden></div>
         <script>window.__CAT_TOTAL__=${arts.length};</script>`
      : emptyState(c.icon, `Aucun article publié dans ${c.label}`, "Cette rubrique s'affichera automatiquement dès qu'un article y sera publié dans le système de contenu.");

    const body = `
    <main><div class="wrap">
      <div class="breadcrumb"><a href="/">Accueil</a> / ${escAttr(c.label)}</div>
      <div class="page-banner">
        <div class="page-banner-icon">${c.icon}</div>
        <div><div class="page-banner-title">${escAttr(c.label)}</div><div class="page-banner-desc">${escAttr(c.description)}</div></div>
      </div>
      <div class="sec-head" style="margin-top:32px"><div class="sec-label">Toute l'actualité ${escAttr(c.label)}</div><div class="sec-rule"></div></div>
      ${gridHtml}
    </div></main>`;

    writeFile(`${c.slug}.html`, wrapPage({
      title: `${c.label} — ${settings.siteName}`,
      description: c.description,
      canonicalPath: `/${c.slug}.html`,
      bodyHtml: body,
      structuredData: [breadcrumbLd([{ name: "Accueil", path: "/" }, { name: c.label, path: `/${c.slug}.html` }])],
    }));
  });
}

/* ══════════════════════════════════════════════
   3) PAGES ARTICLE
   ══════════════════════════════════════════════ */
function buildArticlePages() {
  publishedArticles.forEach((a, idx) => {
    const cat = catBySlug[a.category] || { label: a.category, color: "#0A1F44" };
    const prev = publishedArticles[idx + 1];
    const next = publishedArticles[idx - 1];
    const related = publishedArticles.filter((x) => x.slug !== a.slug && x.category === a.category).slice(0, 3);

    const heroBg = a.mainImage && a.mainImage.url ? `url('${escAttr(a.mainImage.url)}') center/cover` : `linear-gradient(135deg,#0A1F44,${cat.color})`;

    const sourcesHtml = (a.sources && a.sources.length)
      ? `<div class="sources-block"><h3>Sources</h3><ul>${a.sources.map((s) => `<li><a href="${escAttr(s.url)}" target="_blank" rel="noopener nofollow">${escAttr(s.name)}</a>${s.description ? " — " + escAttr(s.description) : ""}</li>`).join("")}</ul></div>`
      : "";

    const correctionHtml = (a.corrections || [])
      .map((c) => `<div class="correction-note">✏️ <strong>Correction</strong> (${formatDateTimeFR(c.date)}) — ${escAttr(c.text)}</div>`)
      .join("");

    const updatedHtml = a.updatedAt
      ? `<div class="update-note">Mis à jour le ${formatDateTimeFR(a.updatedAt)}.</div>`
      : "";

    const navHtml = (prev || next)
      ? `<div class="article-nav">
          ${prev ? `<a href="/article/${prev.slug}.html"><div class="an-label">← Article précédent</div><div class="an-title">${escAttr(prev.title)}</div></a>` : "<div></div>"}
          ${next ? `<a class="an-next" href="/article/${next.slug}.html"><div class="an-label">Article suivant →</div><div class="an-title">${escAttr(next.title)}</div></a>` : "<div></div>"}
        </div>` : "";

    const relatedHtml = related.length
      ? `<div class="sec-head"><div class="sec-label">Articles similaires</div><div class="sec-rule"></div></div><div class="news-grid">${related.map(newsCard).join("")}</div>`
      : "";

    const authorName = a.author ? a.author.name : "Rédaction";
    const authorInitial = authorName.charAt(0).toUpperCase();
    const authorPhoto = a.author && a.author.photo
      ? `<img class="author-photo" src="${escAttr(a.author.photo)}" alt="${escAttr(authorName)}">`
      : `<div class="author-photo ph-placeholder">${authorInitial}</div>`;
    const authorLink = a.authorId ? `/auteur/${a.authorId}.html` : null;

    const body = `
    <main><div class="wrap" style="max-width:760px">
      <div class="breadcrumb"><a href="/">Accueil</a> / <a href="/${cat.slug || a.category}.html">${escAttr(cat.label)}</a> / ${escAttr(a.title)}</div>
      <article>
        ${articleBadges(a)}
        <span class="${cat.tagClass || "tag"}" style="margin-top:10px;display:inline-block">${escAttr(cat.label)}</span>
        ${a.kicker ? `<div class="update-note" style="font-size:13px;color:var(--orange);font-weight:700;margin-top:14px">${escAttr(a.kicker)}</div>` : ""}
        <h1 style="font-family:'Playfair Display',serif;font-size:32px;font-weight:900;color:var(--navy);margin:10px 0 14px;line-height:1.2">${escAttr(a.title)}</h1>
        <p style="font-size:16px;color:var(--gray-dk);line-height:1.7;margin-bottom:18px">${escAttr(a.excerpt)}</p>

        <div class="author-card">
          ${authorPhoto}
          <div>
            ${authorLink ? `<a href="${authorLink}" class="author-name" style="text-decoration:none">${escAttr(authorName)}</a>` : `<div class="author-name">${escAttr(authorName)}</div>`}
            <div class="author-role">${formatDateFR(a.publishedAt)} · ${a.readingTime} min de lecture</div>
            ${updatedHtml}
          </div>
        </div>

        <div class="modal-hero" style="height:340px;border-radius:var(--r-md);overflow:hidden;background:${heroBg};margin:24px 0">
        </div>
        ${a.mainImage && (a.mainImage.caption || a.mainImage.credit) ? `<div class="update-note" style="margin-bottom:20px">${escAttr(a.mainImage.caption || "")}${a.mainImage.credit ? " — © " + escAttr(a.mainImage.credit) : ""}</div>` : ""}

        ${correctionHtml}

        <div class="modal-body article-body" style="font-size:15px;line-height:1.85;color:#2D3748">${a.content}</div>

        ${sourcesHtml}

        <div style="display:flex;gap:10px;margin:28px 0;flex-wrap:wrap">
          <button onclick="shareArticle('twitter')" class="page-btn">Partager sur X</button>
          <button onclick="shareArticle('facebook')" class="page-btn">Facebook</button>
          <button onclick="shareArticle('whatsapp')" class="page-btn">WhatsApp</button>
          <button onclick="shareArticle('copy')" id="copyLinkBtn" class="page-btn">Copier le lien</button>
        </div>

        ${navHtml}
      </article>
      ${relatedHtml}
    </div></main>`;

    const seoTitle = (a.seo && a.seo.title) || a.title;
    const seoDesc = (a.seo && a.seo.description) || a.excerpt;
    const ogImg = (a.seo && a.seo.ogImage) || (a.mainImage && a.mainImage.url) || undefined;

    const articleLd = {
      "@context": "https://schema.org",
      "@type": "NewsArticle",
      headline: a.title,
      description: a.excerpt,
      image: a.mainImage && a.mainImage.url ? [a.mainImage.url] : undefined,
      author: { "@type": "Person", name: authorName },
      publisher: { "@type": "Organization", name: settings.siteName, logo: { "@type": "ImageObject", url: BASE_URL + "/icon-512.png" } },
      datePublished: a.publishedAt || undefined,
      dateModified: a.updatedAt || a.publishedAt || undefined,
      mainEntityOfPage: { "@type": "WebPage", "@id": `${BASE_URL}/article/${a.slug}.html` },
    };

    writeFile(`article/${a.slug}.html`, wrapPage({
      extraHead: '<link rel="stylesheet" href="/assets/article-body.css">',
      title: `${seoTitle} — ${settings.siteName}`,
      description: seoDesc,
      canonicalPath: `/article/${a.slug}.html`,
      ogImage: ogImg,
      bodyHtml: body,
      structuredData: [articleLd, breadcrumbLd([{ name: "Accueil", path: "/" }, { name: cat.label, path: `/${a.category}.html` }, { name: a.title, path: `/article/${a.slug}.html` }])],
    }));
  });
}

/* ══════════════════════════════════════════════
   4) PAGES AUTEUR
   ══════════════════════════════════════════════ */
function buildAuthorPages() {
  authors.forEach((author) => {
    const arts = publishedArticles.filter((a) => a.authorId === author.id);
    const gridHtml = arts.length
      ? `<div class="news-grid">${arts.map(newsCard).join("")}</div>`
      : emptyState("📝", "Aucun article publié pour le moment", "Les articles de cet auteur apparaîtront ici dès leur publication.");

    const photo = author.photo
      ? `<img class="author-photo" style="width:96px;height:96px" src="${escAttr(author.photo)}" alt="${escAttr(author.name)}">`
      : `<div class="author-photo ph-placeholder" style="width:96px;height:96px;font-size:32px">${escAttr(author.name.charAt(0))}</div>`;

    const social = author.social
      ? Object.entries(author.social).filter(([, v]) => v).map(([k, v]) => `<a class="soc-btn" href="${escAttr(v)}" rel="noopener">${escAttr(k[0].toUpperCase())}</a>`).join("")
      : "";

    const body = `
    <main><div class="wrap">
      <div class="breadcrumb"><a href="/">Accueil</a> / <a href="/equipe.html">Équipe</a> / ${escAttr(author.name)}</div>
      <div class="author-card" style="padding:28px">
        ${photo}
        <div>
          <div class="author-name" style="font-size:20px">${escAttr(author.name)}</div>
          <div class="author-role">${escAttr(author.role || "")}</div>
          <p class="author-bio">${escAttr(author.bio || "")}</p>
          ${social ? `<div class="ft-social" style="margin-top:10px">${social}</div>` : ""}
        </div>
      </div>
      <div class="sec-head" style="margin-top:24px"><div class="sec-label">Articles publiés</div><div class="sec-rule"></div></div>
      ${gridHtml}
    </div></main>`;

    writeFile(`auteur/${author.id}.html`, wrapPage({
      title: `${author.name} — ${settings.siteName}`,
      description: author.bio || `Articles de ${author.name} sur ${settings.siteName}.`,
      canonicalPath: `/auteur/${author.id}.html`,
      bodyHtml: body,
      structuredData: [{ "@context": "https://schema.org", "@type": "Person", name: author.name, description: author.bio, jobTitle: author.role }],
    }));
  });
}

/* ══════════════════════════════════════════════
   5) PAGES TAG
   ══════════════════════════════════════════════ */
function buildTagPages() {
  const tagSlugs = new Set();
  publishedArticles.forEach((a) => (a.tags || []).forEach((t) => tagSlugs.add(t)));
  tagSlugs.forEach((tagName) => {
    const slug = slugify(tagName);
    const arts = publishedArticles.filter((a) => (a.tags || []).includes(tagName));
    const gridHtml = arts.length ? `<div class="news-grid">${arts.map(newsCard).join("")}</div>` : emptyState("🏷️", "Aucun article pour ce tag", "Revenez bientôt.");
    const body = `
    <main><div class="wrap">
      <div class="breadcrumb"><a href="/">Accueil</a> / Tag / ${escAttr(tagName)}</div>
      <div class="page-banner"><div class="page-banner-icon">🏷️</div><div><div class="page-banner-title">#${escAttr(tagName)}</div><div class="page-banner-desc">${arts.length} article${arts.length > 1 ? "s" : ""}</div></div></div>
      <div class="sec-head" style="margin-top:32px"><div class="sec-label">Articles tagués « ${escAttr(tagName)} »</div><div class="sec-rule"></div></div>
      ${gridHtml}
    </div></main>`;
    writeFile(`tag/${slug}.html`, wrapPage({
      title: `#${tagName} — ${settings.siteName}`,
      description: `Tous les articles de ${settings.siteName} tagués ${tagName}.`,
      canonicalPath: `/tag/${slug}.html`,
      bodyHtml: body,
    }));
  });
}

/* ══════════════════════════════════════════════
   6) PAGES STATIQUES (fragments /pages/*.html)
   ══════════════════════════════════════════════ */
const STATIC_PAGES = {
  "a-propos.html": { title: "Qui sommes-nous ? — HNet Media", description: "La mission, les valeurs et l'engagement éditorial de HNet Media." },
  "equipe.html": { title: "Notre équipe — HNet Media", description: "La rédaction de HNet Media." },
  "charte-editoriale.html": { title: "Charte éditoriale — HNet Media", description: "Les principes déontologiques de la rédaction de HNet Media." },
  "partenaires.html": { title: "Partenaires — HNet Media", description: "Les partenaires de HNet Media." },
  "publicite.html": { title: "Publicité — HNet Media", description: "Annoncez sur HNet Media : formats, audience, contact commercial." },
  "carrieres.html": { title: "Carrières — HNet Media", description: "Rejoindre la rédaction de HNet Media." },
  "contact.html": { title: "Contact — HNet Media", description: "Contactez la rédaction de HNet Media." },
  "mentions-legales.html": { title: "Mentions légales — HNet Media", description: "Mentions légales du site HNet Media." },
  "cgu.html": { title: "Conditions générales d'utilisation — HNet Media", description: "CGU du site HNet Media." },
  "confidentialite.html": { title: "Politique de confidentialité — HNet Media", description: "Politique de confidentialité de HNet Media." },
  "cookies.html": { title: "Cookies — HNet Media", description: "Politique relative aux cookies de HNet Media." },
  "plan-du-site.html": { title: "Plan du site — HNet Media", description: "Toutes les pages du site HNet Media." },
  "recherche.html": { title: "Recherche — HNet Media", description: "Recherchez un article sur HNet Media." },
};

function injectDynamicBlocks(html, filename) {
  if (filename === "equipe.html") {
    const teamHtml = authors.length
      ? `<div class="static-grid">${authors.map((a) => `
          <a class="static-card" href="/auteur/${a.id}.html" style="text-decoration:none">
            <strong>${escAttr(a.name)}</strong><span>${escAttr(a.role || "")}</span>
          </a>`).join("")}</div>`
      : emptyState("👥", "Fiches de l'équipe à venir", "Les profils des journalistes s'afficheront ici dès qu'ils seront ajoutés.");
    html = html.replace('<div id="teamList"><!--TEAM--></div>', `<div id="teamList">${teamHtml}</div>`);
  }
  if (filename === "partenaires.html" && settings.partners && settings.partners.length) {
    const partnersHtml = `<div class="static-grid">${settings.partners.map((p) => `<a class="static-card" href="${escAttr(p.link)}" target="_blank" rel="noopener"><strong>${escAttr(p.name)}</strong><span>${escAttr(p.description || "")}</span></a>`).join("")}</div>`;
    html = html.replace(/<div id="partnersList">[\s\S]*?<\/div>\s*<\/div>/, `<div id="partnersList">${partnersHtml}</div></div>`);
  }
  if (filename === "carrieres.html" && settings.jobs && settings.jobs.length) {
    const jobsHtml = `<div class="static-grid">${settings.jobs.map((j) => `<div class="static-card"><strong>${escAttr(j.title)}</strong><span>${escAttr(j.contractType)} · ${escAttr(j.location)}</span></div>`).join("")}</div>`;
    html = html.replace(/<div id="jobsList">[\s\S]*?<\/div>\s*<\/div>/, `<div id="jobsList">${jobsHtml}</div></div>`);
  }
  return html;
}

function buildStaticPages() {
  Object.entries(STATIC_PAGES).forEach(([filename, meta]) => {
    let fragment = readFile(path.join(PAGES_DIR, filename));
    fragment = injectDynamicBlocks(fragment, filename);
    const body = `<main>${fragment}</main>`;
    writeFile(filename, wrapPage({
      title: meta.title,
      description: meta.description,
      canonicalPath: `/${filename}`,
      bodyHtml: body,
    }));
  });

  // 404
  const fragment404 = readFile(path.join(PAGES_DIR, "404.html"));
  writeFile("404.html", wrapPage({
    title: "Page introuvable — HNet Media",
    description: "La page demandée n'existe pas.",
    canonicalPath: "/404.html",
    bodyHtml: `<main>${fragment404}</main>`,
    noindex: true,
  }));
}

/* ══════════════════════════════════════════════
   7) INDEX DE RECHERCHE (JSON pour recherche.html)
   ══════════════════════════════════════════════ */
function buildSearchIndex() {
  const index = publishedArticles.map((a) => {
    const cat = catBySlug[a.category] || { label: a.category, tagClass: "tag" };
    return {
      slug: a.slug,
      title: a.title,
      excerpt: a.excerpt,
      category: a.category,
      categoryLabel: cat.label,
      tagClass: cat.tagClass,
      tags: a.tags || [],
      authorName: a.author ? a.author.name : "Rédaction",
      publishedAt: a.publishedAt,
      publishedLabel: formatDateFR(a.publishedAt),
    };
  });
  writeFile("content/search-index.json", JSON.stringify(index));
}

/* ══════════════════════════════════════════════
   8) SITEMAP.XML / RSS.XML / ROBOTS.TXT
   ══════════════════════════════════════════════ */
function buildSitemap() {
  const urls = [
    { loc: "/", priority: "1.0", freq: "hourly" },
    ...categories.map((c) => ({ loc: `/${c.slug}.html`, priority: "0.8", freq: "hourly" })),
    { loc: "/recherche.html", priority: "0.3", freq: "weekly" },
    ...Object.keys(STATIC_PAGES).filter((f) => f !== "recherche.html").map((f) => ({ loc: `/${f}`, priority: "0.4", freq: "monthly" })),
    ...publishedArticles.map((a) => ({ loc: `/article/${a.slug}.html`, priority: "0.7", freq: "monthly", lastmod: a.updatedAt || a.publishedAt })),
    ...authors.map((au) => ({ loc: `/auteur/${au.id}.html`, priority: "0.3", freq: "weekly" })),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>
    <loc>${BASE_URL}${u.loc}</loc>
    ${u.lastmod ? `<lastmod>${new Date(u.lastmod).toISOString().split("T")[0]}</lastmod>` : ""}
    <changefreq>${u.freq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join("\n")}
</urlset>`;
  writeFile("sitemap.xml", xml);
}

function buildRss() {
  const items = publishedArticles.slice(0, 30).map((a) => `
  <item>
    <title>${escAttr(a.title)}</title>
    <link>${BASE_URL}/article/${a.slug}.html</link>
    <guid>${BASE_URL}/article/${a.slug}.html</guid>
    <description>${escAttr(a.excerpt)}</description>
    <pubDate>${a.publishedAt ? new Date(a.publishedAt).toUTCString() : ""}</pubDate>
  </item>`).join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>${escAttr(settings.siteName)}</title>
  <link>${BASE_URL}</link>
  <description>${escAttr(settings.description)}</description>
  <language>fr-fr</language>
  ${items || "<!-- Aucun article publié pour le moment -->"}
</channel></rss>`;
  writeFile("rss.xml", xml);
}

function buildRobots() {
  writeFile("robots.txt", `User-agent: *
Allow: /
Disallow: /admin

Sitemap: ${BASE_URL}/sitemap.xml
`);
}

/* ══════════════════════════════════════════════
   EXÉCUTION
   ══════════════════════════════════════════════ */
function run() {
  if (fs.existsSync(DIST_DIR)) fs.rmSync(DIST_DIR, { recursive: true, force: true });
  ensureDir(DIST_DIR);

  buildHome();
  buildCategoryPages();
  buildArticlePages();
  buildAuthorPages();
  buildTagPages();
  buildStaticPages();
  buildSearchIndex();
  buildSitemap();
  buildRss();
  buildRobots();

  copyDir(path.join(ROOT, "assets"), path.join(DIST_DIR, "assets"));
  // Espace rédaction (/admin) : page + programme + éditeur compilé. Le fichier source
  // de l'éditeur (editor.src.js) n'est pas publié.
  copyDir(path.join(ROOT, "admin-app"), path.join(DIST_DIR, "admin"));
  fs.rmSync(path.join(DIST_DIR, "admin", "editor.src.js"), { force: true });
  // Seul dist/content/search-index.json (articles publics uniquement) est généré
  // plus haut, pour la recherche. Aucun brouillon ni article programmé n'est lu.
  ["favicon.svg", "favicon.ico", "favicon-16.png", "favicon-32.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "site.webmanifest"]
    .forEach((f) => { if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(DIST_DIR, f)); });

  console.log(`✅ Build terminé : ${publishedArticles.length} article(s) publié(s), ${categories.length} rubriques, ${authors.length} auteur(s).`);
  console.log(`📁 Site généré dans /dist — prêt à déployer.`);
}

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL absente : le site est construit à partir de la base Neon.\n   En local : copiez .env.example en .env.local. Sur Vercel : Settings → Environment Variables (Production).");
    process.exit(1);
  }
  init(await loadContent());
  run();
  await require("./server/db").getDb().end();
})().catch((e) => {
  console.error("❌ Build impossible :", e && e.message ? e.message : e);
  process.exit(1);
});
