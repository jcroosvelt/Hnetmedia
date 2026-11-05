/* ══════════════════════════════════════════════
   HNet Media — main.js
   Comportements communs à toutes les pages :
   date, navigation active, langue, animations,
   partage social.
   ══════════════════════════════════════════════ */
(function () {
  "use strict";

  /* ── DATE DU JOUR ── */
  var dateEl = document.getElementById("currentDate");
  if (dateEl) {
    var d = new Date();
    dateEl.textContent = d.toLocaleDateString("fr-FR", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  }

  /* ── ANNÉE COURANTE (footer) ── */
  var yearEl = document.getElementById("ftYear");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ── LIEN DE NAVIGATION ACTIF (basé sur l'URL réelle) ── */
  var path = location.pathname.replace(/\/index\.html$/, "/").replace(/\.html$/, "").replace(/\/$/, "") || "/";
  document.querySelectorAll(".nav-link").forEach(function (a) {
    var route = a.getAttribute("data-route");
    var isHome = route === "home" && (path === "" || path === "/");
    var isMatch = route && path === "/" + route;
    if (isHome || isMatch) a.classList.add("on");
  });

  /* ── LANGUE (FR/EN) ──
     Phase 1 : bascule l'attribut lang + les libellés UI marqués [data-i18n].
     Le contenu éditorial (articles) n'est pas encore traduit :
     tant qu'aucune traduction réelle n'existe, on reste en FR
     et on l'indique honnêtement plutôt que de le taire. */
  var LANG_KEY = "hnet_lang";
  window.setLang = function (lang, btn) {
    document.querySelectorAll(".lang-btn").forEach(function (b) { b.classList.remove("active"); });
    if (btn) btn.classList.add("active");
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
    document.documentElement.setAttribute("lang", lang);
    document.querySelectorAll("[data-i18n-fr]").forEach(function (el) {
      var txt = lang === "en" ? el.getAttribute("data-i18n-en") : el.getAttribute("data-i18n-fr");
      if (txt) el.textContent = txt;
    });
    var noticeId = "langNotice";
    var existing = document.getElementById(noticeId);
    if (lang === "en") {
      if (!existing) {
        var n = document.createElement("div");
        n.id = noticeId;
        n.className = "dev-notice";
        n.style.maxWidth = "1400px";
        n.style.margin = "10px auto 0";
        n.textContent = "English version coming soon — editorial content is not yet translated. Showing French content.";
        var header = document.querySelector(".site-header");
        if (header) header.insertAdjacentElement("afterend", n);
      }
    } else if (existing) {
      existing.remove();
    }
  };
  (function initLang() {
    var saved = "fr";
    try { saved = localStorage.getItem(LANG_KEY) || "fr"; } catch (e) {}
    var btn = document.querySelector('.lang-btn[data-lang="' + saved + '"]');
    window.setLang(saved, btn);
  })();

  /* ── ANIMATIONS AU DÉFILEMENT ── */
  var revObs = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) { entry.target.classList.add("in"); revObs.unobserve(entry.target); }
    });
  }, { threshold: 0.08 });
  document.querySelectorAll(".reveal").forEach(function (el) { revObs.observe(el); });

  /* ── MOUVEMENT RÉDUIT ── */
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.querySelectorAll(".ticker-tape").forEach(function (t) { t.style.animation = "none"; });
  }

  /* ── PARTAGE SOCIAL (URL réelle de la page) ── */
  window.shareArticle = function (platform) {
    var url = encodeURIComponent(window.location.href);
    var title = encodeURIComponent(document.title);
    var map = {
      twitter: "https://twitter.com/intent/tweet?url=" + url + "&text=" + title,
      facebook: "https://www.facebook.com/sharer.php?u=" + url,
      whatsapp: "https://wa.me/?text=" + title + "%20" + url
    };
    if (platform === "copy") {
      navigator.clipboard && navigator.clipboard.writeText(window.location.href);
      var btn = document.getElementById("copyLinkBtn");
      if (btn) { var old = btn.textContent; btn.textContent = "Lien copié !"; setTimeout(function () { btn.textContent = old; }, 1800); }
      return;
    }
    if (map[platform]) window.open(map[platform], "_blank", "noopener,width=600,height=500");
  };

  /* ── REDIRECTION DES ANCIENNES URLS EN #/route (ex-SPA) ──
     Conserve les anciens liens/favoris fonctionnels (règle #44). */
  (function legacyHashRedirect() {
    var LEGACY_ROUTES = ["politique","monde","economie","sport","culture","tech","sante","opinions",
      "a-propos","equipe","charte-editoriale","partenaires","publicite","carrieres","contact",
      "mentions-legales","cgu","confidentialite","cookies","plan-du-site"];
    var h = (location.hash || "").replace(/^#\/?/, "").split("?")[0];
    if (h === "newsletter") return; // ancre valide, pas une route
    if (h === "" || h === "/") return;
    if (LEGACY_ROUTES.indexOf(h) !== -1) {
      location.replace("/" + h + (location.search || ""));
    } else if (h === "home") {
      location.replace("/");
    }
  })();
})();
