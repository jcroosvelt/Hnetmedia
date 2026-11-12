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
const DIST_DIR = process.env.BUILD_OUT ? path.resolve(process.env.BUILD_OUT) : path.join(ROOT, "dist"); // BUILD_OUT : tests uniquement

/* ── UTILITAIRES ── */
function readFile(p) {
  return fs.readFileSync(p, "utf8");
}
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}
function writeFile(relPath, content) {
  const full = path.join(DIST_DIR, LANG === "en" && !/^(robots\.txt|sitemap\.xml)$/.test(relPath) ? path.join("en", relPath) : relPath);
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
/* ── LANGUES : le site existe en français (racine) et en anglais (/en) ──
   Un seul code génère les deux : tout texte français passe par T(), qui renvoie la traduction
   du dictionnaire i18n/en.js. Une traduction manquante est signalée à la fin du build. */
const LANGS = ["fr", "en"];
let LANG = "fr";
let PREFIX = "";           // préfixe d'URL : "" ou "/en"
const EN = require("./i18n/en");
const MISSING = new Set();
function fill(str, vars) { return vars ? str.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : vars[k])) : str; }
function T(fr, vars) {
  if (LANG === "fr") return fill(fr, vars);
  if (Object.prototype.hasOwnProperty.call(EN, fr)) return fill(EN[fr], vars);
  MISSING.add(fr);
  return fill(fr, vars);
}
const LOCALE = () => (LANG === "en" ? "en-GB" : "fr-FR");
function formatDateFR(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(LOCALE(), { day: "numeric", month: "long", year: "numeric" });
}
function formatDateTimeFR(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(LOCALE(), { day: "numeric", month: "long", year: "numeric" }) +
    (LANG === "en" ? " at " : " à ") + d.toLocaleTimeString(LOCALE(), { hour: "2-digit", minute: "2-digit" });
}
// Libellés de rubrique selon la langue (repli sur le français si aucune version anglaise n'est saisie).
const catLabel = (c) => (LANG === "en" && c.labelEn) || c.label;
const catDesc = (c) => (LANG === "en" && c.descriptionEn) || c.description || "";
// Réglage d'identité selon la langue : version anglaise saisie dans /admin, sinon traduction du texte d'origine.
function langSetting(key) {
  if (LANG === "fr") return settings[key] || "";
  return settings[key + "En"] || (Object.prototype.hasOwnProperty.call(EN, settings[key]) ? EN[settings[key]] : settings[key]) || "";
}
// URLs publiques : toujours « propres » (sans .html), préfixées par la langue, absolues pour canonical / sitemap / RSS.
const cleanPath = (p) => String(p).replace(/\/index\.html$/, "/").replace(/\.html(?=$|[#?])/, "") || "/";
const pub = (p, lang) => { const pre = (lang || LANG) === "en" ? "/en" : ""; const c = cleanPath(p); return BASE_URL + (c === "/" ? (pre || "/") : pre + c); };

/* Adresse publique du site (canonical, sitemap, RSS, JSON-LD, aperçus de partage).
   La variable SITE_URL (Vercel) prime : au jour de l'achat du domaine, il suffit de la changer.
   Sinon, repli sur le réglage « baseUrl » de la base. Seule une origine https valide est acceptée. */
function siteBase(cfg) {
  try {
    const u = new URL(String(process.env.SITE_URL || "").trim());
    if (u.protocol === "https:" && (u.pathname === "/" || u.pathname === "")) return u.origin;
  } catch (e) { /* SITE_URL absente ou invalide : repli */ }
  return String(cfg.baseUrl).replace(/\/$/, "");
}

/* ── CONTENU (lu dans Neon avant la génération, voir init()) ── */
let settings, categories, authors, allArticles, catBySlug, authorById, publishedArticles, BASE_URL, socLinks;
let headerHtml, footerHtml, orgLd, websiteLd;
const NOW = new Date();

// Appelée une fois : contenu commun aux deux langues.
function init(content) {
  settings = content.settings;
  categories = content.categories;
  authors = content.authors;
  allArticles = content.articles;
  catBySlug = Object.fromEntries(categories.map((c) => [c.slug, c]));
  authorById = Object.fromEntries(authors.map((a) => [a.id, a]));
  BASE_URL = siteBase(settings);
  // Réseaux sociaux : uniquement ceux renseignés dans /admin › Réglages (aucun lien factice « # »).
  const SOC = [["twitter", "𝕏", "X (Twitter)"], ["facebook", "f", "Facebook"], ["linkedin", "in", "LinkedIn"], ["youtube", "▶", "YouTube"], ["instagram", "📷", "Instagram"]];
  socLinks = SOC.filter(([k]) => settings.social && /^https:\/\//.test(settings.social[k] || ""));
  socLinks.html = socLinks.length
    ? `<div class="ft-social" style="margin-top:18px">${socLinks.map(([k, ico, label]) => `<a class="soc-btn" href="${escAttr(settings.social[k])}" target="_blank" rel="noopener" aria-label="${label}">${ico}</a>`).join("")}</div>`
    : "";
}

// Un article est publiable dans une langue s'il y est écrit à l'origine, ou si sa traduction a été relue et validée par un humain.
function articleIn(a, lang) {
  const tr = a.tr && a.tr[lang];
  if (!tr || !String(tr.title).trim() || !String(tr.content).trim()) return null;
  if (lang !== a.originalLang && !tr.reviewed) return null;
  return tr;
}

// Prépare tout ce qui dépend de la langue : articles de cette langue, en-tête, pied de page, données structurées.
function prepareLang(lang) {
  LANG = lang;
  PREFIX = lang === "en" ? "/en" : "";

  publishedArticles = allArticles
    .filter((a) => a.status === "publie" && (!a.publishedAt || new Date(a.publishedAt) <= NOW))
    .map((a) => {
      const tr = articleIn(a, lang);
      if (!tr) return null;
      return {
        ...a, kicker: tr.kicker, title: tr.title, excerpt: tr.excerpt, content: tr.content, seo: tr.seo,
        readingTime: lang === a.originalLang && a.readingTime ? a.readingTime : estimateReadingTime(tr.content),
        author: a.authorId ? authorById[a.authorId] : (a.authorName ? { name: a.authorName } : null),
        avail: { fr: Boolean(articleIn(a, "fr")), en: Boolean(articleIn(a, "en")) },
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));

  if (lang === "fr" && !publishedArticles.length) {
    console.log("ℹ️  Aucun article publié pour le moment. Le site affichera des états vides professionnels — comportement attendu tant qu'aucun article n'est publié dans /admin.");
  }

  /* ── PARTIELS ── */
  const tr = (html) => html.replace(/\{\{([^}]+)\}\}/g, (m, k) => T(k));
  const nav = [`<a class="nav-link" data-route="home" href="/">${T("Accueil")}</a>`]
    .concat(categories.map((c) => `<a class="nav-link" data-route="${c.slug}" href="/${c.slug}">${escAttr(catLabel(c))}</a>`)).join("\n      ");
  headerHtml = tr(readFile(path.join(PARTIALS_DIR, "header.html"))).replace("<!--NAV-->", () => nav);
  const footText = lang === "en" ? settings.footerTextEn : settings.footerText;
  footerHtml = tr(readFile(path.join(PARTIALS_DIR, "footer.html")))
    .replace("<!--FT_CATS-->", () => categories.map((c) => `<li><a href="/${c.slug}">${escAttr(catLabel(c))}</a></li>`).join("\n        "))
    .replace("<!--SOCIAL-->", () => socLinks.html);
  // Texte du pied de page : réglage facultatif (/admin › Réglages), sinon le texte d'origine du partiel.
  if (footText) footerHtml = footerHtml.replace(/<p class="ft-desc">[\s\S]*?<\/p>/, () => `<p class="ft-desc">${escAttr(footText)}</p>`);

  // Bandeau « urgent » : uniquement s'il existe de vraies alertes (sinon aucun bandeau, jamais de message de remplissage).
  const urgentArticles = publishedArticles.filter((a) => a.urgent);
  if (urgentArticles.length) {
    const tickerItems = urgentArticles.map((a) => `<a href="/article/${a.slug}" class="ticker-item">◆ ${escAttr(a.title)}</a>`).join("");
    headerHtml = headerHtml.replace("<!--TICKER_ITEMS-->", () => tickerItems + tickerItems); // dupliqué pour un défilement continu
  } else {
    headerHtml = headerHtml.replace(/<!--TICKER-->[\s\S]*?<!--\/TICKER-->\s*/, "");
  }

  orgLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: settings.siteName,
    url: pub("/"),
    logo: BASE_URL + "/icon-512.png",
    ...(socLinks.length ? { sameAs: socLinks.map(([k]) => settings.social[k]) } : {}),
  };
  websiteLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: settings.siteName,
    url: pub("/"),
    inLanguage: lang,
    potentialAction: {
      "@type": "SearchAction",
      target: `${pub("/recherche")}?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

// Image téléversée sur ce site (/media/<id>) → adresse complète pour les aperçus de partage et Google.
function absUrl(u) { return u && u.startsWith("/") ? BASE_URL + u : u; }

/* ── LIENS INTERNES : propres (sans .html) et préfixés par la langue (/en) ── */
const ASSET_RE = /^\/(assets|media|api|admin)\/|^\/(favicon|icon-|apple-touch|site\.webmanifest|sitemap\.xml|robots\.txt)/;
function localize(html) {
  return html.replace(/(href|action)="(\/[^"]*)"/g, (m, attr, u) => {
    if (u.startsWith("//") || ASSET_RE.test(u)) return m;
    const clean = u.replace(/\/index\.html(?=$|[#?])/, "/").replace(/\.html(?=$|[#?])/, "");
    if (LANG !== "en") return `${attr}="${clean}"`;
    return `${attr}="${clean === "/" ? "/en" : "/en" + (clean.startsWith("/#") || clean.startsWith("/?") ? clean.slice(1) : clean)}"`;
  });
}

/* ── SQUELETTE DE PAGE ──
   alt : où ce contenu existe dans l'autre langue ({ fr, en } booléens ; par défaut dans les deux). */
function wrapPage({ title, description, canonicalPath, ogImage, bodyHtml, structuredData = [], noindex = false, extraHead = "", alt }) {
  const here = cleanPath(canonicalPath);
  const canonical = pub(here);
  const has = Object.assign({ fr: true, en: true }, alt || {});
  const both = has.fr && has.en && !noindex;
  const hreflang = both
    ? `<link rel="alternate" hreflang="fr" href="${pub(here, "fr")}">\n<link rel="alternate" hreflang="en" href="${pub(here, "en")}">\n<link rel="alternate" hreflang="x-default" href="${pub(here, "fr")}">`
    : "";
  // Sélecteur de langue : vrai lien vers la même page dans l'autre langue, sinon vers l'accueil de cette langue.
  const langSw = `<div class="lang-sw" role="group" aria-label="${T("Langue")}">${["fr", "en"].map((l) => {
    const target = has[l] ? (l === "en" ? (here === "/" ? "/en" : "/en" + here) : here) : (l === "en" ? "/en" : "/");
    return `<a class="lang-btn${l === LANG ? " active" : ""}" href="${target}" hreflang="${l}" lang="${l}"${l === LANG ? ' aria-current="true"' : ""}>${l.toUpperCase()}</a>`;
  }).join("")}</div>`;
  const jsonLd = structuredData.map((obj) => `<script type="application/ld+json">${jsonForHtml(obj)}</script>`).join("\n");
  const inner = localize(`${headerHtml}\n${bodyHtml}\n${footerHtml}`).replace("<!--LANGSW-->", () => langSw);
  const rssHref = LANG === "en" ? "/en/rss.xml" : "/rss.xml";
  return `<!DOCTYPE html>
<html lang="${LANG}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escAttr(title)}</title>
<meta name="description" content="${escAttr(description)}">
${noindex ? '<meta name="robots" content="noindex, nofollow">' : '<meta name="robots" content="index, follow">'}
<link rel="canonical" href="${canonical}">
${hreflang}
<meta name="theme-color" content="#0A1F44">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escAttr(settings.siteName)}">
<meta property="og:title" content="${escAttr(title)}">
<meta property="og:description" content="${escAttr(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${ogImage || BASE_URL + "/og-default.png"}">
<meta property="og:locale" content="${LANG === "en" ? "en_GB" : "fr_FR"}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escAttr(title)}">
<meta name="twitter:description" content="${escAttr(description)}">
<link rel="alternate" type="application/rss+xml" title="${escAttr(settings.siteName)}" href="${rssHref}">
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
${inner}
<script src="/assets/main.js" defer></script>
<script src="/assets/contact.js" defer></script>
<script src="/assets/comments.js" defer></script>
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
  if (a.urgent) b += `<span class="badge badge-urgent">${T("Urgent")}</span> `;
  if (a.sponsored) b += `<span class="badge badge-sponsored">${T("Sponsorisé")}</span> `;
  if (a.type === "tribune") b += `<span class="badge badge-tribune">${T("Tribune")}</span> `;
  if (a.type === "editorial") b += `<span class="badge badge-editorial">${T("Éditorial")}</span> `;
  if (a.type === "analyse") b += `<span class="badge badge-analyse">${T("Analyse")}</span> `;
  if (a.type === "opinion") b += `<span class="badge badge-opinion">${T("Opinion")}</span> `;
  return b;
}

// Fond d'une vignette : image de l'article, sinon le logo sur le bleu marine du site (jamais d'arc-en-ciel de rubriques).
function coverStyle(a) {
  return a.mainImage && a.mainImage.url
    ? `background:url('${escAttr(a.mainImage.url)}') center/cover`
    : "background:var(--navy) url('/assets/logo.png') center/44% no-repeat";
}

const authorLabel = (a) => (a.author ? a.author.name : T("Rédaction"));
const minLabel = (a) => T("{n} min", { n: a.readingTime });

function newsCard(a) {
  const cat = catBySlug[a.category] || { label: a.category, tagClass: "tag" };
  return `
  <a class="news-card reveal" href="/article/${a.slug}">
    <div class="nc-img">
      <div class="nc-img-bg" style="${coverStyle(a)};height:100%"></div>
      <span class="${cat.tagClass} nc-badge">${escAttr(catLabel(cat))}</span>
    </div>
    <h3 class="nc-title">${escAttr(a.title)}</h3>
    <p class="nc-excerpt">${escAttr(a.excerpt)}</p>
    <div class="nc-foot"><span class="nc-author">${escAttr(authorLabel(a))}</span><span>·</span><span>${formatDateFR(a.publishedAt)} · ${minLabel(a)}</span></div>
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
      item: pub(it.path),
    })),
  };
}

/* ══════════════════════════════════════════════
   1) PAGE D'ACCUEIL
   ══════════════════════════════════════════════ */
function buildHome() {
  const featured = publishedArticles.find((a) => a.featured) || publishedArticles[0];
  const side = publishedArticles.filter((a) => a !== featured).slice(0, 4);
  const shown = new Set([featured, ...side]);
  const latest = publishedArticles.filter((a) => !shown.has(a)).slice(0, 6);
  const opinions = publishedArticles.filter((a) => a.category === "opinions").slice(0, 4);
  const meta = (a) => `${escAttr(authorLabel(a))} · ${formatDateFR(a.publishedAt)}`;
  const tagline = langSetting("tagline"), desc = langSetting("description");
  const chips = `<div class="cat-chips">${categories.map((c) => `<a class="cat-chip" href="/${c.slug}.html">${escAttr(catLabel(c))}</a>`).join("")}</div>`;

  let heroHtml;
  if (featured) {
    const cat = catBySlug[featured.category] || { label: featured.category };
    heroHtml = `
    <section class="hero${side.length ? "" : " hero-solo"}" aria-label="${T("À la une")}">
      <a class="hero-main" href="/article/${featured.slug}.html" style="${coverStyle(featured)}">
        <span class="hero-scrim" aria-hidden="true"></span>
        <div class="hero-overlay">
          <span class="tag">${escAttr(catLabel(cat))}</span>
          <h1 class="hero-title">${escAttr(featured.title)}</h1>
          <p class="hero-sub">${escAttr(featured.excerpt)}</p>
          <div class="hero-meta"><strong>${escAttr(authorLabel(featured))}</strong><span>${formatDateFR(featured.publishedAt)}</span><span>${T("{n} min de lecture", { n: featured.readingTime })}</span></div>
        </div>
      </a>
      ${side.length ? `<div class="hero-side">
        <div class="side-head">${T("À lire aussi")}</div>
        ${side.map((a) => {
          const c = catBySlug[a.category] || { label: a.category };
          return `<a class="side-art" href="/article/${a.slug}.html">
            <div class="sa-thumb" style="${coverStyle(a)}"></div>
            <div class="sa-body"><span class="sa-cat">${escAttr(catLabel(c))}</span><h4 class="sa-title">${escAttr(a.title)}</h4>
            <div class="sa-meta">${meta(a)}</div></div>
          </a>`;
        }).join("")}
      </div>` : ""}
    </section>`;
  } else {
    heroHtml = `
    <section class="welcome" aria-label="${T("Bienvenue")}">
      <div class="welcome-in">
        <span class="welcome-eyebrow">${escAttr(settings.siteName)}</span>
        <h1>${escAttr(tagline)}</h1>
        <p>${escAttr(desc)}</p>
        <p class="welcome-note">${T("Les articles publiés apparaîtront ici dès leur mise en ligne.")}</p>
        <div class="welcome-cta"><a class="btn-orange" href="/a-propos">${T("Découvrir {name}", { name: escAttr(settings.siteName) })}</a><a class="btn-ghost-light" href="/recherche">${T("Rechercher")}</a></div>
      </div>
    </section>`;
  }

  const latestHtml = latest.length
    ? `<div class="sec-head"><div class="sec-label">${T("Dernières nouvelles")}</div><div class="sec-rule"></div></div>
       <div class="news-grid">${latest.map(newsCard).join("")}</div>`
    : "";

  // Une section par rubrique QUI A des articles (aucun bloc vide empilé).
  const catSectionsHtml = categories
    .filter((c) => c.slug !== "opinions")
    .map((c) => {
      const arts = publishedArticles.filter((a) => a.category === c.slug).slice(0, 4);
      if (!arts.length) return "";
      const [lead, ...rest] = arts;
      return `
      <section class="cat-block" aria-label="${escAttr(catLabel(c))}">
        <div class="sec-head"><div class="sec-label">${escAttr(catLabel(c))}</div><div class="sec-rule"></div><a href="/${c.slug}.html" class="sec-more">${T("Tout voir →")}</a></div>
        <div class="cat-grid">
          ${newsCard(lead)}
          ${rest.length ? `<div class="cat-list">${rest.map((a) => `<a class="side-art" href="/article/${a.slug}.html">
            <div class="sa-thumb" style="${coverStyle(a)}"></div>
            <div class="sa-body"><h4 class="sa-title">${escAttr(a.title)}</h4><div class="sa-meta">${meta(a)}</div></div>
          </a>`).join("")}</div>` : ""}
        </div>
      </section>`;
    }).join("");

  const opCat = catBySlug.opinions || { label: "Opinions & Analyses" };
  const opinionsHtml = opinions.length
    ? `<div class="sec-head"><div class="sec-label">${escAttr(catLabel(opCat))}</div><div class="sec-rule"></div><a href="/opinions.html" class="sec-more">${T("Tout voir →")}</a></div>
       <div class="op-grid">${opinions.map((a) => `
      <a class="op-card reveal" href="/article/${a.slug}.html">
        <div class="op-av">${escAttr(authorLabel(a).charAt(0))}</div>
        <div class="op-name">${escAttr(authorLabel(a))}</div>
        <div class="op-role">${articleBadges(a) || T("Contributeur")}</div>
        <p class="op-title">${escAttr(a.title)}</p>
      </a>`).join("")}</div>`
    : "";

  // « Les plus lus » : rempli dans le navigateur à partir des lectures réellement mesurées ; masqué tant qu'il n'y en a aucune.
  const mostRead = `<section id="mostRead" hidden aria-label="${T("Les plus lus")}">
      <div class="sec-head"><div class="sec-label">${T("Les plus lus")}</div><div class="sec-rule"></div></div>
      <ol class="most-read" id="mostReadList"></ol>
    </section>`;

  const body = `
  <main>
  <div class="wrap home">
    ${heroHtml}
    ${latestHtml}
    ${catSectionsHtml}
    ${opinionsHtml}
    ${mostRead}
    <div class="sec-head"><div class="sec-label">${T("Explorer par rubrique")}</div><div class="sec-rule"></div></div>
    ${chips}
  </div>
  </main>`;

  writeFile("index.html", wrapPage({
    title: `${settings.siteName} – ${tagline}`,
    description: desc,
    canonicalPath: "/",
    bodyHtml: body,
    structuredData: [orgLd, websiteLd],
  }));
}

/* ══════════════════════════════════════════════
   2) PAGES DE RUBRIQUES
   ══════════════════════════════════════════════ */
const PER_PAGE = 10;
const catPath = (slug, page) => (page <= 1 ? `/${slug}` : `/${slug}/page/${page}`);

/* Barre de pagination : Précédent, 1 … courante±1 … dernière, Suivant. Liens réels (fonctionne sans JavaScript). */
function paginationHtml(slug, page, pages) {
  if (pages <= 1) return "";
  const nums = [];
  for (let i = 1; i <= pages; i++) if (i === 1 || i === pages || Math.abs(i - page) <= 1) nums.push(i);
  const items = [];
  if (page > 1) items.push(`<a class="page-btn" href="${catPath(slug, page - 1)}" rel="prev" aria-label="${T("Page précédente")}">${T("‹ Précédent")}</a>`);
  let last = 0;
  for (const n of nums) {
    if (n - last > 1) items.push('<span class="page-btn" style="border-color:transparent;background:none;cursor:default" aria-hidden="true">…</span>');
    items.push(n === page
      ? `<a class="page-btn active" href="${catPath(slug, n)}" aria-current="page" aria-label="${T("Page {n}, page actuelle", { n })}">${n}</a>`
      : `<a class="page-btn" href="${catPath(slug, n)}" aria-label="${T("Page {n}", { n })}">${n}</a>`);
    last = n;
  }
  if (page < pages) items.push(`<a class="page-btn" href="${catPath(slug, page + 1)}" rel="next" aria-label="${T("Page suivante")}">${T("Suivant ›")}</a>`);
  return `<nav class="pagination" id="catPagination" aria-label="${T("Pagination — page {page} sur {pages}", { page, pages })}">${items.join("")}</nav>`;
}

/* Liste paginée générique (tags, auteurs) : page 1 = `${base}.html`, suivantes = `${base}/page/N.html`, rel=prev/next. */
function writePaged(base, arts, { body, title, description, emptyHtml, structuredData }) {
  const pages = Math.max(1, Math.ceil(arts.length / PER_PAGE));
  const fileOf = (p) => (p === 1 ? `${base}.html` : `${base}/page/${p}.html`);
  for (let page = 1; page <= pages; page++) {
    const slice = arts.slice((page - 1) * PER_PAGE, page * PER_PAGE);
    const grid = arts.length ? `<div class="news-grid">${slice.map(newsCard).join("")}</div>${paginationHtml(base, page, pages)}` : emptyHtml;
    const links = [page > 1 ? `<link rel="prev" href="${pub("/" + fileOf(page - 1))}">` : "", page < pages ? `<link rel="next" href="${pub("/" + fileOf(page + 1))}">` : ""].filter(Boolean).join("\n");
    writeFile(fileOf(page), wrapPage({
      title: title(page), description: description(page), canonicalPath: `/${fileOf(page)}`, extraHead: links,
      bodyHtml: body(grid, page), structuredData: structuredData ? structuredData(page) : [],
    }));
  }
}

function buildCategoryPages() {
  categories.forEach((c) => {
    const arts = publishedArticles.filter((a) => a.category === c.slug);
    const pages = Math.max(1, Math.ceil(arts.length / PER_PAGE));
    const label = catLabel(c);
    for (let page = 1; page <= pages; page++) {
      const slice = arts.slice((page - 1) * PER_PAGE, page * PER_PAGE);
      const gridHtml = arts.length
        ? `<div class="news-grid" id="catGrid">${slice.map(newsCard).join("")}</div>
           ${paginationHtml(c.slug, page, pages)}`
        : emptyState(c.icon, T("Aucun article publié dans {label}", { label }), T("Cette rubrique s'affichera automatiquement dès qu'un article y sera publié."));

      const body = `
      <main><div class="wrap">
        <div class="breadcrumb"><a href="/">${T("Accueil")}</a> / ${page > 1 ? `<a href="${catPath(c.slug, 1)}">${escAttr(label)}</a> / ${T("Page {n}", { n: page })}` : escAttr(label)}</div>
        <div class="page-banner">
          <div class="page-banner-icon">${c.icon}</div>
          <div><div class="page-banner-title">${escAttr(label)}</div><div class="page-banner-desc">${escAttr(catDesc(c))}</div></div>
        </div>
        <div class="sec-head" style="margin-top:32px"><div class="sec-label">${T("Toute l'actualité {label}", { label: escAttr(label) })}${page > 1 ? ` — ${T("page {n}", { n: page })}` : ""}</div><div class="sec-rule"></div></div>
        ${gridHtml}
      </div></main>`;

      const file = page === 1 ? `${c.slug}.html` : `${c.slug}/page/${page}.html`;
      const canonical = page === 1 ? `/${c.slug}` : `/${c.slug}/page/${page}`;
      const links = [page > 1 ? `<link rel="prev" href="${pub(page === 2 ? `/${c.slug}` : `/${c.slug}/page/${page - 1}`)}">` : "",
        page < pages ? `<link rel="next" href="${pub(`/${c.slug}/page/${page + 1}`)}">` : ""].filter(Boolean).join("\n");
      writeFile(file, wrapPage({
        title: `${label}${page > 1 ? ` — ${T("page {n}", { n: page })}` : ""} — ${settings.siteName}`,
        description: page > 1 ? `${catDesc(c)} (${T("page {n}", { n: page })})` : catDesc(c),
        canonicalPath: canonical,
        extraHead: links,
        bodyHtml: body,
        structuredData: [breadcrumbLd([{ name: T("Accueil"), path: "/" }, { name: label, path: `/${c.slug}` }].concat(page > 1 ? [{ name: T("Page {n}", { n: page }), path: canonical }] : []))],
      }));
    }
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

    const heroBg = coverStyle(a).replace(/^background:/, "");

    const sourcesHtml = (a.sources && a.sources.length)
      ? `<div class="sources-block"><h3>${T("Sources")}</h3><ul>${a.sources.map((s) => `<li><a href="${escAttr(s.url)}" target="_blank" rel="noopener nofollow">${escAttr(s.name)}</a>${s.description ? " — " + escAttr(s.description) : ""}</li>`).join("")}</ul></div>`
      : "";

    const correctionHtml = (a.corrections || [])
      .map((c) => `<div class="correction-note">✏️ <strong>${T("Correction")}</strong> (${formatDateTimeFR(c.date)}) — ${escAttr(c.text)}</div>`)
      .join("");

    const updatedHtml = a.updatedAt
      ? `<div class="update-note">${T("Mis à jour le {date}.", { date: formatDateTimeFR(a.updatedAt) })}</div>`
      : "";

    const navHtml = (prev || next)
      ? `<div class="article-nav">
          ${prev ? `<a href="/article/${prev.slug}.html"><div class="an-label">${T("← Article précédent")}</div><div class="an-title">${escAttr(prev.title)}</div></a>` : "<div></div>"}
          ${next ? `<a class="an-next" href="/article/${next.slug}.html"><div class="an-label">${T("Article suivant →")}</div><div class="an-title">${escAttr(next.title)}</div></a>` : "<div></div>"}
        </div>` : "";

    const relatedHtml = related.length
      ? `<div class="sec-head"><div class="sec-label">${T("Articles similaires")}</div><div class="sec-rule"></div></div><div class="news-grid">${related.map(newsCard).join("")}</div>`
      : "";

    const authorName = authorLabel(a);
    const authorInitial = authorName.charAt(0).toUpperCase();
    const authorPhoto = a.author && a.author.photo
      ? `<img class="author-photo" src="${escAttr(a.author.photo)}" alt="${escAttr(authorName)}">`
      : `<div class="author-photo ph-placeholder">${authorInitial}</div>`;
    const authorLink = a.authorId ? `/auteur/${a.authorId}.html` : null;

    const commentsHtml = `<section class="comments" id="comments" data-article="${escAttr(a.slug)}" aria-labelledby="commentsTitle">
        <h2 id="commentsTitle">${T("Commentaires")}</h2>
        <p class="cm-note">${T("Les commentaires sont relus par la rédaction avant d'être publiés. Votre adresse e-mail n'est jamais affichée.")}</p>
        <div class="cm-list" id="commentsList" aria-live="polite"><p class="cm-loading">${T("Chargement des commentaires…")}</p></div>
        <form class="contact-form comment-form" id="commentForm" novalidate>
          <div class="cm-replying" id="commentReplying" hidden></div>
          <input type="text" name="name" placeholder="${T("Votre nom")}" aria-label="${T("Votre nom")}" autocomplete="name" maxlength="60" required>
          <input type="email" name="email" placeholder="${T("Votre adresse e-mail (facultative)")}" aria-label="${T("Votre adresse e-mail (facultative)")}" autocomplete="email" maxlength="254">
          <textarea name="body" placeholder="${T("Votre commentaire")}" aria-label="${T("Votre commentaire")}" maxlength="2000" required></textarea>
          <div style="position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden" aria-hidden="true"><label>${T("Ne pas remplir")}<input type="text" name="hp" tabindex="-1" autocomplete="off"></label></div>
          <button type="submit">${T("Envoyer mon commentaire")}</button>
        </form>
        <div id="commentMsg" class="dev-notice" role="status" aria-live="polite" hidden></div>
      </section>`;

    const body = `
    <main><div class="wrap" style="max-width:760px">
      <div class="breadcrumb"><a href="/">${T("Accueil")}</a> / <a href="/${cat.slug || a.category}.html">${escAttr(catLabel(cat))}</a> / ${escAttr(a.title)}</div>
      <article>
        ${articleBadges(a)}
        <span class="${cat.tagClass || "tag"}" style="margin-top:10px;display:inline-block">${escAttr(catLabel(cat))}</span>
        ${a.kicker ? `<div class="update-note" style="font-size:13px;color:var(--orange);font-weight:700;margin-top:14px">${escAttr(a.kicker)}</div>` : ""}
        <h1 style="font-family:'Playfair Display',serif;font-size:32px;font-weight:900;color:var(--navy);margin:10px 0 14px;line-height:1.2">${escAttr(a.title)}</h1>
        <p style="font-size:16px;color:var(--gray-dk);line-height:1.7;margin-bottom:18px">${escAttr(a.excerpt)}</p>

        <div class="author-card">
          ${authorPhoto}
          <div>
            ${authorLink ? `<a href="${authorLink}" class="author-name" style="text-decoration:none">${escAttr(authorName)}</a>` : `<div class="author-name">${escAttr(authorName)}</div>`}
            <div class="author-role">${formatDateFR(a.publishedAt)} · ${T("{n} min de lecture", { n: a.readingTime })}</div>
            ${updatedHtml}
          </div>
        </div>

        <div class="modal-hero" role="img" aria-label="${escAttr(a.mainImage && a.mainImage.alt ? a.mainImage.alt : a.title)}" style="height:340px;border-radius:var(--r-md);overflow:hidden;background:${heroBg};margin:24px 0">
        </div>
        ${a.mainImage && (a.mainImage.caption || a.mainImage.credit) ? `<div class="update-note" style="margin-bottom:20px">${escAttr(a.mainImage.caption || "")}${a.mainImage.credit ? " — © " + escAttr(a.mainImage.credit) : ""}</div>` : ""}

        ${correctionHtml}

        <div class="modal-body article-body" style="font-size:15px;line-height:1.85;color:#2D3748">${a.content}</div>

        ${sourcesHtml}

        <div style="display:flex;gap:10px;margin:28px 0;flex-wrap:wrap">
          <button onclick="shareArticle('twitter')" class="page-btn">${T("Partager sur X")}</button>
          <button onclick="shareArticle('facebook')" class="page-btn">Facebook</button>
          <button onclick="shareArticle('whatsapp')" class="page-btn">WhatsApp</button>
          <button onclick="shareArticle('copy')" id="copyLinkBtn" class="page-btn">${T("Copier le lien")}</button>
        </div>

        ${navHtml}
      </article>
      ${commentsHtml}
      ${relatedHtml}
    </div></main>`;

    const seoTitle = (a.seo && a.seo.title) || a.title;
    const seoDesc = (a.seo && a.seo.description) || a.excerpt;
    const ogImg = absUrl((a.seo && a.seo.ogImage) || (a.mainImage && a.mainImage.url) || undefined);

    const articleLd = {
      "@context": "https://schema.org",
      "@type": "NewsArticle",
      headline: a.title,
      description: a.excerpt,
      inLanguage: LANG,
      image: a.mainImage && a.mainImage.url ? [absUrl(a.mainImage.url)] : undefined,
      author: { "@type": "Person", name: authorName },
      publisher: { "@type": "Organization", name: settings.siteName, logo: { "@type": "ImageObject", url: BASE_URL + "/icon-512.png" } },
      datePublished: a.publishedAt || undefined,
      dateModified: a.updatedAt || a.publishedAt || undefined,
      mainEntityOfPage: { "@type": "WebPage", "@id": pub(`/article/${a.slug}`) },
    };

    writeFile(`article/${a.slug}.html`, wrapPage({
      extraHead: '<link rel="stylesheet" href="/assets/article-body.css">\n<link rel="stylesheet" href="/assets/comments.css">',
      title: `${seoTitle} — ${settings.siteName}`,
      description: seoDesc,
      canonicalPath: `/article/${a.slug}`,
      ogImage: ogImg,
      bodyHtml: body,
      alt: a.avail,
      structuredData: [articleLd, breadcrumbLd([{ name: T("Accueil"), path: "/" }, { name: catLabel(cat), path: `/${a.category}` }, { name: a.title, path: `/article/${a.slug}` }])],
    }));
  });
}

/* ══════════════════════════════════════════════
   4) PAGES AUTEUR
   ══════════════════════════════════════════════ */
function buildAuthorPages() {
  authors.forEach((author) => {
    const arts = publishedArticles.filter((a) => a.authorId === author.id);

    const photo = author.photo
      ? `<img class="author-photo" style="width:96px;height:96px" src="${escAttr(author.photo)}" alt="${escAttr(author.name)}">`
      : `<div class="author-photo ph-placeholder" style="width:96px;height:96px;font-size:32px">${escAttr(author.name.charAt(0))}</div>`;

    const social = author.social
      ? Object.entries(author.social).filter(([, v]) => v).map(([k, v]) => `<a class="soc-btn" href="${escAttr(v)}" rel="noopener" aria-label="${escAttr(k)}">${escAttr(k[0].toUpperCase())}</a>`).join("")
      : "";

    writePaged(`auteur/${author.id}`, arts, {
      emptyHtml: emptyState("📝", T("Aucun article publié pour le moment"), T("Les articles de cet auteur apparaîtront ici dès leur publication.")),
      body: (grid, page) => `
    <main><div class="wrap">
      <div class="breadcrumb"><a href="/">${T("Accueil")}</a> / <a href="/equipe.html">${T("Équipe")}</a> / ${page > 1 ? `<a href="/auteur/${author.id}">${escAttr(author.name)}</a> / ${T("Page {n}", { n: page })}` : escAttr(author.name)}</div>
      <div class="author-card" style="padding:28px">
        ${photo}
        <div>
          <div class="author-name" style="font-size:20px">${escAttr(author.name)}</div>
          <div class="author-role">${escAttr(author.role || "")}</div>
          <p class="author-bio">${escAttr(author.bio || "")}</p>
          ${social ? `<div class="ft-social" style="margin-top:10px">${social}</div>` : ""}
        </div>
      </div>
      <div class="sec-head" style="margin-top:24px"><div class="sec-label">${T("Articles publiés")}${page > 1 ? ` — ${T("page {n}", { n: page })}` : ""}</div><div class="sec-rule"></div></div>
      ${grid}
    </div></main>`,
      title: (page) => `${author.name}${page > 1 ? ` — ${T("page {n}", { n: page })}` : ""} — ${settings.siteName}`,
      description: () => author.bio || T("Articles de {name} sur {site}.", { name: author.name, site: settings.siteName }),
      structuredData: () => [{ "@context": "https://schema.org", "@type": "Person", name: author.name, description: author.bio, jobTitle: author.role }],
    });
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
    writePaged(`tag/${slug}`, arts, {
      emptyHtml: emptyState("🏷️", T("Aucun article pour ce tag"), T("Revenez bientôt.")),
      body: (grid, page) => `
    <main><div class="wrap">
      <div class="breadcrumb"><a href="/">${T("Accueil")}</a> / ${T("Tag")} / ${page > 1 ? `<a href="/tag/${slug}">${escAttr(tagName)}</a> / ${T("Page {n}", { n: page })}` : escAttr(tagName)}</div>
      <div class="page-banner"><div class="page-banner-icon">🏷️</div><div><div class="page-banner-title">#${escAttr(tagName)}</div><div class="page-banner-desc">${T(arts.length > 1 ? "{n} articles" : "{n} article", { n: arts.length })}</div></div></div>
      <div class="sec-head" style="margin-top:32px"><div class="sec-label">${T("Articles tagués « {tag} »", { tag: escAttr(tagName) })}${page > 1 ? ` — ${T("page {n}", { n: page })}` : ""}</div><div class="sec-rule"></div></div>
      ${grid}
    </div></main>`,
      title: (page) => `#${tagName}${page > 1 ? ` — ${T("page {n}", { n: page })}` : ""} — ${settings.siteName}`,
      description: () => T("Tous les articles de {site} tagués {tag}.", { site: settings.siteName, tag: tagName }),
    });
  });
}

/* ══════════════════════════════════════════════
   6) PAGES STATIQUES (fragments /pages/*.html en français, /pages/en/*.html en anglais)
   ══════════════════════════════════════════════ */
const STATIC_PAGES = {
  "a-propos.html": { title: "Qui sommes-nous ?", description: "La mission, les valeurs et l'engagement éditorial de HNet Media." },
  "equipe.html": { title: "Notre équipe", description: "La rédaction de HNet Media." },
  "charte-editoriale.html": { title: "Charte éditoriale", description: "Les principes déontologiques de la rédaction de HNet Media." },
  "partenaires.html": { title: "Partenaires", description: "Les partenaires de HNet Media." },
  "publicite.html": { title: "Publicité", description: "Annoncez sur HNet Media : formats, audience, contact commercial." },
  "carrieres.html": { title: "Carrières", description: "Rejoindre la rédaction de HNet Media." },
  "contact.html": { title: "Contact", description: "Contactez la rédaction de HNet Media." },
  "mentions-legales.html": { title: "Mentions légales", description: "Mentions légales du site HNet Media." },
  "cgu.html": { title: "Conditions générales d'utilisation", description: "CGU du site HNet Media." },
  "confidentialite.html": { title: "Politique de confidentialité", description: "Politique de confidentialité de HNet Media." },
  "cookies.html": { title: "Politique relative aux cookies", description: "Politique relative aux cookies de HNet Media." },
  "plan-du-site.html": { title: "Plan du site", description: "Toutes les pages du site HNet Media." },
  "recherche.html": { title: "Recherche", description: "Recherchez un article sur HNet Media." },
};

function injectDynamicBlocks(html, filename) {
  if (filename === "equipe.html") {
    const teamHtml = authors.length
      ? `<div class="static-grid">${authors.map((a) => `
          <a class="static-card" href="/auteur/${a.id}.html" style="text-decoration:none">
            <strong>${escAttr(a.name)}</strong><span>${escAttr(a.role || "")}</span>
          </a>`).join("")}</div>`
      : emptyState("👥", T("Fiches de l'équipe à venir"), T("Les profils des journalistes s'afficheront ici dès qu'ils seront ajoutés."));
    html = html.replace('<div id="teamList"><!--TEAM--></div>', () => `<div id="teamList">${teamHtml}</div>`);
  }
  if (filename === "contact.html") {
    // La valeur envoyée reste le texte enregistré dans la base (validé par le serveur) ; seul l'affichage change de langue.
    const cats = (settings.contactCategories && settings.contactCategories.length ? settings.contactCategories : ["Autre"]);
    const show = (c) => (LANG === "en" && Object.prototype.hasOwnProperty.call(EN, c) ? EN[c] : c);
    html = html.replace("<!--CONTACT_CATEGORIES-->", cats.map((c) => `<option value="${escAttr(c)}">${escAttr(show(c))}</option>`).join("\n        "));
  }
  if (filename === "plan-du-site.html") {
    html = html.replace("<!--SITEMAP_CATS-->", () => categories.map((c) => `<li><a href="/${c.slug}" style="color:var(--navy-lt)">${escAttr(catLabel(c))}</a></li>`).join("\n      "));
  }
  if (filename === "mentions-legales.html") {
    const L = settings.legal || {};
    const e = (x) => escAttr(x);
    const pub_ = [T("{name} — Média d'information en ligne.", { name: e(L.publisherName || "HNet Media") })];
    if (L.publisherAddress) pub_.push(`${T("Adresse :")} ${e(L.publisherAddress)}.`);
    if (L.registration) pub_.push(`${T("Immatriculation :")} ${e(L.registration)}.`);
    pub_.push(L.director ? `${T("Directeur de la publication :")} ${e(L.director)}.` : T("Directeur de la publication : [à renseigner]."));
    pub_.push(`${T("Contact :")} redaction@hnetmedia.com.`);
    const host = L.hostName ? `${e(L.hostName)}${L.hostAddress ? `, ${e(L.hostAddress)}` : ""}.` : T("[Nom et adresse de l'hébergeur à renseigner].");
    const missing = [!L.director && T("directeur de la publication"), !L.hostName && T("hébergeur"), !L.registration && T("numéro d'immatriculation")].filter(Boolean);
    const notice = missing.length ? `<div class="dev-notice">⚠️ ${T("Mentions légales incomplètes : il manque {list}. Ces informations doivent être complétées par l'éditeur avant toute mise en ligne publique.", { list: missing.join(", ") })}</div>` : "";
    html = html.replace("<!--LEGAL_NOTICE-->", () => notice).replace("<!--LEGAL_PUBLISHER-->", () => pub_.join(" ")).replace("<!--LEGAL_HOST-->", () => host);
  }
  if (filename === "partenaires.html" && settings.partners && settings.partners.length) {
    const partnersHtml = `<div class="static-grid">${settings.partners.map((p) => {
      const inner = `<strong>${escAttr(p.name)}</strong><span>${escAttr(p.description || "")}</span>`;
      return /^https?:\/\//.test(p.link || "")
        ? `<a class="static-card" href="${escAttr(p.link)}" target="_blank" rel="noopener">${inner}</a>`
        : `<div class="static-card">${inner}</div>`;
    }).join("")}</div>`;
    html = html.replace(/<div id="partnersList">[\s\S]*?<\/div>\s*<\/div>/, () => `<div id="partnersList">${partnersHtml}</div></div>`);
  }
  if (filename === "carrieres.html" && settings.jobs && settings.jobs.length) {
    const apply = T("Postuler");
    const jobsHtml = `<div class="static-grid">${settings.jobs.map((j) => {
      const meta = [j.contractType, j.location].filter(Boolean).map(escAttr).join(" · ");
      const desc = escAttr(j.description || "").replace(/\n/g, "<br>");
      const how = /^https:\/\//.test(j.applyUrl || "")
        ? `<a href="${escAttr(j.applyUrl)}" target="_blank" rel="noopener" style="color:var(--orange);font-weight:600">${apply}</a>`
        : (j.applyEmail ? `<a href="mailto:${escAttr(j.applyEmail)}" style="color:var(--orange);font-weight:600">${apply} : ${escAttr(j.applyEmail)}</a>` : "");
      return `<div class="static-card"><strong>${escAttr(j.title)}</strong>${meta ? `<span>${meta}</span>` : ""}<span>${desc}</span>${how ? `<span>${how}</span>` : ""}</div>`;
    }).join("")}</div>`;
    html = html.replace(/<div id="jobsList">[\s\S]*?<\/div>\s*<\/div>/, () => `<div id="jobsList">${jobsHtml}</div></div>`);
  }
  return html;
}

function buildStaticPages() {
  Object.entries(STATIC_PAGES).forEach(([filename, meta]) => {
    const custom = (settings.pages || {})[`${LANG}/${filename.replace(/\.html$/, "")}`];
    let fragment, title = T(meta.title), description = T(meta.description);
    if (custom) {
      // Page modifiée dans /admin : titre échappé, contenu déjà nettoyé côté serveur (liste blanche).
      fragment = `<div class="wrap">
  <div class="breadcrumb"><a href="/">${T("Accueil")}</a> / ${escAttr(custom.title)}</div>
  <div class="static-wrap" style="margin-left:0">
    <h1>${escAttr(custom.title)}</h1>
    ${custom.content}
  </div>
</div>`;
      title = custom.title;
      if (custom.description) description = custom.description;
    } else {
      const dir = LANG === "en" ? path.join(PAGES_DIR, "en") : PAGES_DIR;
      fragment = injectDynamicBlocks(readFile(path.join(dir, filename)), filename);
    }
    writeFile(filename, wrapPage({
      title: `${title} — ${settings.siteName}`,
      description,
      canonicalPath: `/${filename}`,
      bodyHtml: `<main>${fragment}</main>`,
    }));
  });

  // 404
  const fragment404 = readFile(path.join(LANG === "en" ? path.join(PAGES_DIR, "en") : PAGES_DIR, "404.html"));
  writeFile("404.html", wrapPage({
    title: `${T("Page introuvable")} — ${settings.siteName}`,
    description: T("La page demandée n'existe pas."),
    canonicalPath: "/404",
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
      categoryLabel: catLabel(cat),
      tagClass: cat.tagClass,
      tags: a.tags || [],
      authorName: authorLabel(a),
      publishedAt: a.publishedAt,
      publishedLabel: formatDateFR(a.publishedAt),
    };
  });
  writeFile("content/search-index.json", JSON.stringify(index));
}

/* ══════════════════════════════════════════════
   8) SITEMAP.XML / RSS.XML / ROBOTS.TXT
   ══════════════════════════════════════════════ */
// Entrées du plan du site, collectées pour chaque langue puis écrites une seule fois (avec les liens d'équivalence hreflang).
const SITEMAP = [];
function collectSitemap() {
  const add = (p, priority, freq, extra = {}) => SITEMAP.push({ lang: LANG, path: cleanPath(p), priority, freq, ...extra });
  add("/", "1.0", "hourly");
  categories.forEach((c) => {
    add(`/${c.slug}`, "0.8", "hourly");
    const n = Math.ceil(publishedArticles.filter((a) => a.category === c.slug).length / PER_PAGE);
    for (let i = 2; i <= n; i++) add(`/${c.slug}/page/${i}`, "0.5", "hourly", { solo: true });
  });
  authors.forEach((au) => {
    add(`/auteur/${au.id}`, "0.3", "weekly");
    const n = Math.ceil(publishedArticles.filter((a) => a.authorId === au.id).length / PER_PAGE);
    for (let i = 2; i <= n; i++) add(`/auteur/${au.id}/page/${i}`, "0.3", "weekly", { solo: true });
  });
  [...new Set(publishedArticles.flatMap((a) => a.tags || []))].forEach((tg) => {
    add(`/tag/${slugify(tg)}`, "0.3", "weekly", { solo: true });
    const n = Math.ceil(publishedArticles.filter((a) => (a.tags || []).includes(tg)).length / PER_PAGE);
    for (let i = 2; i <= n; i++) add(`/tag/${slugify(tg)}/page/${i}`, "0.3", "weekly", { solo: true });
  });
  add("/recherche", "0.3", "weekly");
  Object.keys(STATIC_PAGES).filter((f) => f !== "recherche.html").forEach((f) => add(`/${f}`, "0.4", "monthly"));
  publishedArticles.forEach((a) => add(`/article/${a.slug}`, "0.7", "monthly", { lastmod: a.updatedAt || a.publishedAt, alts: a.avail }));
}

function buildSitemap() {
  const xmlEsc = (x) => String(x).replace(/&/g, "&amp;");
  const pathsBoth = new Set(SITEMAP.filter((e) => e.lang === "en").map((e) => e.path));
  const entry = (e) => {
    // équivalent dans l'autre langue : pages communes, ou article disponible dans les deux langues
    const both = !e.solo && (e.alts ? e.alts.fr && e.alts.en : pathsBoth.has(e.path) && SITEMAP.some((x) => x.lang === "fr" && x.path === e.path));
    const links = both ? ["fr", "en"].map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${pub(e.path, l)}"/>`).join("\n") : "";
    return `  <url>
    <loc>${xmlEsc(pub(e.path, e.lang))}</loc>
    ${e.lastmod ? `<lastmod>${new Date(e.lastmod).toISOString().split("T")[0]}</lastmod>` : ""}
    <changefreq>${e.freq}</changefreq>
    <priority>${e.priority}</priority>
${links}
  </url>`;
  };
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${SITEMAP.map(entry).join("\n")}
</urlset>`;
  LANG = "fr"; writeFile("sitemap.xml", xml);
}

function buildRss() {
  const items = publishedArticles.slice(0, 30).map((a) => `
  <item>
    <title>${escAttr(a.title)}</title>
    <link>${pub(`/article/${a.slug}`)}</link>
    <guid>${pub(`/article/${a.slug}`)}</guid>
    <description>${escAttr(a.excerpt)}</description>
    <pubDate>${a.publishedAt ? new Date(a.publishedAt).toUTCString() : ""}</pubDate>
  </item>`).join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>${escAttr(settings.siteName)}</title>
  <link>${pub("/")}</link>
  <description>${escAttr(langSetting("description"))}</description>
  <language>${LANG === "en" ? "en-gb" : "fr-fr"}</language>
  ${items || "<!-- Aucun article publié pour le moment -->"}
</channel></rss>`;
  writeFile("rss.xml", xml);
}

function buildRobots() {
  LANG = "fr";
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

  const counts = {};
  for (const lang of LANGS) {
    prepareLang(lang);
    buildHome();
    buildCategoryPages();
    buildArticlePages();
    buildAuthorPages();
    buildTagPages();
    buildStaticPages();
    buildSearchIndex();
    buildRss();
    collectSitemap();
    counts[lang] = publishedArticles.length;
  }
  buildSitemap();
  buildRobots();

  copyDir(path.join(ROOT, "assets"), path.join(DIST_DIR, "assets"));
  // Espace rédaction (/admin) : page + programme + éditeur compilé. Le fichier source
  // de l'éditeur (editor.src.js) n'est pas publié.
  copyDir(path.join(ROOT, "admin-app"), path.join(DIST_DIR, "admin"));
  fs.rmSync(path.join(DIST_DIR, "admin", "editor.src.js"), { force: true });
  // Seuls dist/content/search-index.json et dist/en/content/search-index.json (articles publics uniquement) sont
  // générés plus haut, pour la recherche. Aucun brouillon ni article programmé n'est lu.
  ["favicon.svg", "favicon.ico", "favicon-16.png", "favicon-32.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "og-default.png", "site.webmanifest"]
    .forEach((f) => { if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(DIST_DIR, f)); });

  console.log(`✅ Build terminé : ${counts.fr} article(s) publié(s) en français, ${counts.en} en anglais, ${categories.length} rubriques, ${authors.length} auteur(s).`);
  if (MISSING.size) {
    console.warn(`⚠️  ${MISSING.size} texte(s) sans traduction anglaise (i18n/en.js) :\n  - ${[...MISSING].join("\n  - ")}`);
    if (process.env.I18N_STRICT === "1") process.exit(2);
  }
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
