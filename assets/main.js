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
    dateEl.textContent = d.toLocaleDateString(document.documentElement.lang === "en" ? "en-GB" : "fr-FR", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  }

  /* ── ANNÉE COURANTE (footer) ── */
  var yearEl = document.getElementById("ftYear");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ── LIEN DE NAVIGATION ACTIF (basé sur l'URL réelle) ── */
  var path = location.pathname.replace(/\/index\.html$/, "/").replace(/\.html$/, "").replace(/^\/en(?=\/|$)/, "").replace(/\/$/, "") || "/";
  document.querySelectorAll(".nav-link").forEach(function (a) {
    var route = a.getAttribute("data-route");
    var isHome = route === "home" && (path === "" || path === "/");
    var isMatch = route && path === "/" + route;
    if (isHome || isMatch) a.classList.add("on");
  });

  /* ── ANIMATIONS AU DÉFILEMENT ── */
  var revObs = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) { entry.target.classList.add("in"); revObs.unobserve(entry.target); }
    });
  }, { threshold: 0.08 });
  document.querySelectorAll(".reveal").forEach(function (el) { revObs.observe(el); });


  /* ── MESURE DES LECTURES (sans donnée personnelle) ──
     Une lecture = une ouverture d'article. Rien n'est envoyé si le visiteur a activé « ne pas suivre » (DNT / GPC) ;
     le serveur ignore en plus les robots et les rechargements rapprochés. Aucun cookie, aucune IP conservée. */
  (function trackView() {
    var articlePath = location.pathname.replace(/^\/en(?=\/)/, "");
    if (!/^\/article\/[a-z0-9-]+(\.html)?$/.test(articlePath)) return;
    if (navigator.doNotTrack === "1" || navigator.globalPrivacyControl) return;
    try {
      var blob = new Blob([JSON.stringify({ path: articlePath })], { type: "application/json" });
      if (!(navigator.sendBeacon && navigator.sendBeacon("/api/views", blob))) {
        fetch("/api/views", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: articlePath }), keepalive: true });
      }
    } catch (e) { /* mesure facultative */ }
  })();

  /* ── « LES PLUS LUS » : classement des lectures réellement mesurées ; la section reste masquée tant qu'il n'y en a pas ── */
  (function mostRead() {
    var box = document.getElementById("mostRead"), list = document.getElementById("mostReadList");
    if (!box || !list || !window.fetch) return;
    var en = document.documentElement.lang === "en";
    fetch("/api/views?top=lus&limit=5&lang=" + (en ? "en" : "fr"), { credentials: "omit" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.items || !d.items.length) return;
        d.items.forEach(function (it, i) {
          var li = document.createElement("li"), a = document.createElement("a"), n = document.createElement("span"), t = document.createElement("span");
          n.className = "mr-n"; n.textContent = String(i + 1);
          t.className = "mr-t"; t.textContent = it.title;
          a.href = (en ? "/en" : "") + it.url; a.appendChild(n); a.appendChild(t);
          li.appendChild(a); list.appendChild(li);
        });
        box.hidden = false;
      })
      .catch(function () { /* classement facultatif */ });
  })();

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
      if (btn) { var old = btn.textContent; btn.textContent = document.documentElement.lang === "en" ? "Link copied!" : "Lien copié !"; setTimeout(function () { btn.textContent = old; }, 1800); }
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
