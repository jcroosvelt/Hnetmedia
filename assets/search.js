/* ══════════════════════════════════════════════
   HNet Media — search.js
   Recherche réellement fonctionnelle, exécutée
   côté client sur l'index généré à partir du
   contenu réel (content/search-index.json).
   Aucun résultat fictif : si l'index est vide,
   un état vide honnête est affiché.
   ══════════════════════════════════════════════ */
(function () {
  "use strict";
  var resultsEl = document.getElementById("searchResults");
  var countEl = document.getElementById("searchResultCount");
  var qInput = document.getElementById("searchQ");
  var catSelect = document.getElementById("filterCategory");
  var tagSelect = document.getElementById("filterTag");
  var sortSelect = document.getElementById("filterSort");
  if (!resultsEl) return;

  function stripAccents(s) {
    return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }

  function getParam(name) {
    return new URLSearchParams(location.search).get(name) || "";
  }

  function render(list) {
    if (!list.length) {
      resultsEl.innerHTML =
        '<div class="empty-state"><div class="es-icon">🔍</div>' +
        "<h3>Aucun résultat</h3>" +
        "<p>Essayez d'autres mots-clés, ou revenez plus tard : de nouveaux articles sont ajoutés régulièrement.</p></div>";
      countEl.textContent = "";
      return;
    }
    countEl.textContent = list.length + " résultat" + (list.length > 1 ? "s" : "");
    resultsEl.innerHTML = list
      .map(function (a) {
        return (
          '<a class="news-card reveal in" href="/article/' + a.slug + '.html">' +
          '<div class="nc-img"><div class="nc-img-bg" style="background:' + (a.bg || "linear-gradient(135deg,#0A1F44,#334E7A)") + ';height:100%"></div>' +
          '<span class="' + (a.tagClass || "tag") + ' nc-badge">' + a.categoryLabel + "</span></div>" +
          '<h3 class="nc-title">' + a.title + "</h3>" +
          '<p class="nc-excerpt">' + a.excerpt + "</p>" +
          '<div class="nc-foot"><span class="nc-author">' + (a.authorName || "Rédaction") + "</span><span>·</span><span>" + (a.publishedLabel || "") + "</span></div>" +
          "</a>"
        );
      })
      .join("");
  }

  function applyFilters(all) {
    var q = stripAccents(qInput.value);
    var cat = catSelect.value;
    var tag = tagSelect.value;
    var list = all.filter(function (a) {
      var hay = stripAccents(a.title + " " + a.excerpt + " " + (a.tags || []).join(" "));
      var matchesQ = !q || hay.indexOf(q) !== -1;
      var matchesCat = !cat || a.category === cat;
      var matchesTag = !tag || (a.tags || []).indexOf(tag) !== -1;
      return matchesQ && matchesCat && matchesTag;
    });
    if (sortSelect.value === "date-asc") list.sort(function (a, b) { return (a.publishedAt || "").localeCompare(b.publishedAt || ""); });
    else list.sort(function (a, b) { return (b.publishedAt || "").localeCompare(a.publishedAt || ""); });
    render(list);
  }

  fetch("/content/search-index.json")
    .then(function (r) { return r.json(); })
    .then(function (all) {
      qInput.value = getParam("q");
      var cats = Array.from(new Set(all.map(function (a) { return a.category; })));
      cats.forEach(function (c) {
        var opt = document.createElement("option");
        opt.value = c;
        opt.textContent = c;
        catSelect.appendChild(opt);
      });
      var tags = Array.from(new Set(all.flatMap(function (a) { return a.tags || []; })));
      tags.forEach(function (t) {
        var opt = document.createElement("option");
        opt.value = t;
        opt.textContent = t;
        tagSelect.appendChild(opt);
      });
      [qInput, catSelect, tagSelect, sortSelect].forEach(function (el) {
        el.addEventListener("input", function () { applyFilters(all); });
      });
      applyFilters(all);
    })
    .catch(function () {
      resultsEl.innerHTML =
        '<div class="empty-state"><div class="es-icon">⚠️</div><h3>Recherche indisponible</h3>' +
        "<p>L'index de recherche n'a pas pu être chargé. Si vous consultez ce site en local, lancez-le via un serveur HTTP (voir README).</p></div>";
    });
})();
