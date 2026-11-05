/* Espace rédaction HNet Media — interface d'administration (JavaScript sans dépendance).
   Toute donnée affichée passe par textContent (jamais innerHTML), sauf l'aperçu d'article,
   qui n'affiche que du HTML déjà filtré par le schéma de l'éditeur. */
(function () {
  "use strict";

  var app = document.getElementById("app");
  var S = { csrf: null, user: null, perms: new Set(), meta: null };
  var cleanup = null; // fonction appelée en quittant une vue (éditeur, minuteurs…)
  var guard = null; // fonction () => true si on peut quitter la vue
  var LANGS = [["fr", "Français"], ["en", "English"], ["ht", "Kreyòl"]];
  var STATUS = { brouillon: "Brouillon", programme: "Programmé", publie: "Publié", archive: "Archivé" };
  var ROLES = { administrateur: "Administrateur", redacteur_en_chef: "Rédacteur en chef", editeur: "Éditeur", journaliste: "Journaliste", contributeur: "Contributeur", commercial: "Commercial" };
  var TYPES = [["information", "Information"], ["opinion", "Opinion"], ["tribune", "Tribune"], ["editorial", "Éditorial"], ["analyse", "Analyse"]];

  var can = function (p) { return S.perms.has(p); };

  /* ───────── Outils DOM ───────── */
  function h(tag, props) {
    var e = document.createElement(tag);
    var after = null;
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "class") e.className = v;
        else if (k === "text") e.textContent = v;
        else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
        else if (k === "value") after = function () { e.value = v; };
        else if (k === "checked") e.checked = !!v;
        else if (k === "disabled") e.disabled = !!v;
        else if (v === true) e.setAttribute(k, "");
        else e.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(e, arguments[i]);
    if (after) after();
    return e;
  }
  function append(parent, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) return c.forEach(function (x) { append(parent, x); });
    parent.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function fmt(iso) { return iso ? new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"; }
  function debounce(fn, ms) { var t; return function () { var a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, ms); }; }

  function toast(msg, isErr) {
    var t = h("div", { class: "hn-toast" + (isErr ? " err" : ""), role: "status", text: msg });
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, isErr ? 6000 : 3500);
  }

  /* ───────── Dialogues ───────── */
  function openDialog(build, wide) {
    return new Promise(function (resolve) {
      var prevFocus = document.activeElement;
      var ov = h("div", { class: "hn-ov", role: "dialog", "aria-modal": "true" });
      var box = h("div", { class: "hn-dlg" + (wide ? " wide" : "") });
      ov.appendChild(box);
      function close(v) { document.removeEventListener("keydown", onKey, true); ov.remove(); if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) { /* ignoré */ } resolve(v); }
      function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); close(null); } }
      document.addEventListener("keydown", onKey, true);
      ov.addEventListener("mousedown", function (e) { if (e.target === ov) close(null); });
      build(box, close);
      document.body.appendChild(ov);
      var first = box.querySelector("input,select,textarea,button");
      if (first) first.focus();
    });
  }

  function ask(title, fields, opts) {
    opts = opts || {};
    return openDialog(function (box, close) {
      var inputs = {};
      var err = h("div", { class: "hn-alert", hidden: true, role: "alert" });
      var form = h("form", { class: "hn-form", novalidate: true });
      form.appendChild(h("h2", { text: title }));
      if (opts.intro) form.appendChild(h("p", { class: "hn-sub", text: opts.intro }));
      fields.forEach(function (f) {
        var id = "dlg-" + f.name;
        var input;
        if (f.type === "select") input = h("select", { id: id, value: f.value }, (f.options || []).map(function (o) { return h("option", { value: o[0], text: o[1] }); }));
        else if (f.type === "textarea") input = h("textarea", { id: id, rows: 4, maxlength: f.max }, f.value || "");
        else input = h("input", { id: id, type: f.type || "text", value: f.value, autocomplete: f.autocomplete || "off", maxlength: f.max, min: f.min });
        if (f.value !== undefined && f.type === "textarea") input.value = f.value;
        inputs[f.name] = input;
        form.appendChild(h("label", { for: id, text: f.label }));
        form.appendChild(input);
        if (f.hint) form.appendChild(h("p", { class: "hn-hint", text: f.hint }));
      });
      form.appendChild(err);
      form.appendChild(h("div", { class: "hn-actions" },
        h("button", { type: "button", class: "hn-btn hn-btn-ghost", onclick: function () { close(null); }, text: "Annuler" }),
        h("button", { type: "submit", class: "hn-btn hn-btn-primary", text: opts.submit || "Valider" })));
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var out = {};
        for (var i = 0; i < fields.length; i++) {
          var f = fields[i];
          var v = inputs[f.name].value;
          if (f.required && !String(v).trim()) { err.textContent = "Le champ « " + f.label.split(" (")[0] + " » est obligatoire."; err.hidden = false; inputs[f.name].focus(); return; }
          out[f.name] = v;
        }
        if (opts.validate) {
          var msg = opts.validate(out);
          if (msg) { err.textContent = msg; err.hidden = false; return; }
        }
        close(out);
      });
      box.appendChild(form);
    });
  }

  function confirmBox(message, opts) {
    opts = opts || {};
    return openDialog(function (box, close) {
      var typed = null;
      var ok = h("button", { type: "button", class: "hn-btn " + (opts.danger ? "hn-btn-danger" : "hn-btn-primary"), text: opts.confirm || "Confirmer", disabled: !!opts.typed });
      box.appendChild(h("h2", { text: opts.title || "Confirmation" }));
      box.appendChild(h("p", { class: "hn-sub", text: message }));
      if (opts.typed) {
        typed = h("input", { type: "text", "aria-label": "Confirmation", autocomplete: "off", oninput: function () { ok.disabled = typed.value.trim() !== opts.typed; } });
        box.appendChild(h("div", { class: "hn-form" }, h("label", { text: "Tapez « " + opts.typed + " » pour confirmer" }), typed));
      }
      ok.addEventListener("click", function () { close(true); });
      box.appendChild(h("div", { class: "hn-actions" }, h("button", { type: "button", class: "hn-btn hn-btn-ghost", onclick: function () { close(false); }, text: "Annuler" }), ok));
    }).then(function (v) { return v === true; });
  }

  /* ───────── API ───────── */
  function ApiError(status, message, data) { var e = new Error(message); e.status = status; e.data = data; return e; }
  function api(method, path, body, opts) {
    var headers = {};
    var payload;
    if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
    if (method !== "GET" && S.csrf) headers["X-CSRF-Token"] = S.csrf;
    return fetch("/api/admin/" + path, { method: method, headers: headers, body: payload, credentials: "same-origin" })
      .catch(function () { throw ApiError(0, "Connexion impossible. Vérifiez votre réseau et réessayez."); })
      .then(function (res) {
        return res.json().catch(function () { return null; }).then(function (data) {
          if (!res.ok) {
            if (res.status === 401 && !(opts && opts.quiet401)) sessionLost();
            throw ApiError(res.status, (data && data.error) || "Erreur (" + res.status + ")", data);
          }
          return data;
        });
      });
  }
  function sessionLost() {
    if (!S.user) return;
    S.user = null; S.csrf = null; S.perms = new Set(); guard = null;
    if (cleanup) { cleanup(); cleanup = null; }
    renderLogin("Votre session a expiré. Reconnectez-vous.");
  }

  /* ───────── Écrans d'accès ───────── */
  function authShell(title, sub, form) {
    clear(app);
    app.appendChild(h("div", { class: "hn-auth" },
      h("div", { class: "hn-card" },
        h("div", { class: "hn-auth-logo" }, h("img", { src: "/assets/logo.png", alt: "HNet Media" })),
        h("h1", { class: "hn-h1", text: title }),
        h("p", { class: "hn-sub", text: sub }),
        form)));
  }

  function renderSetup() {
    var err = h("div", { class: "hn-alert", hidden: true, role: "alert" });
    var f = {
      token: h("input", { id: "s-token", type: "password", autocomplete: "off", required: true }),
      name: h("input", { id: "s-name", type: "text", autocomplete: "name", required: true }),
      email: h("input", { id: "s-email", type: "email", autocomplete: "email", required: true }),
      pw: h("input", { id: "s-pw", type: "password", autocomplete: "new-password", required: true, minlength: 12 }),
      pw2: h("input", { id: "s-pw2", type: "password", autocomplete: "new-password", required: true }),
    };
    var btn = h("button", { type: "submit", class: "hn-btn hn-btn-primary", text: "Créer le compte administrateur" });
    var form = h("form", { class: "hn-form", novalidate: true },
      h("label", { for: "s-token", text: "Code d'installation" }), f.token,
      h("p", { class: "hn-hint", text: "La valeur de ADMIN_SETUP_TOKEN que vous avez enregistrée dans Vercel. Elle ne sert qu'une fois." }),
      h("label", { for: "s-name", text: "Votre nom" }), f.name,
      h("label", { for: "s-email", text: "Votre e-mail" }), f.email,
      h("label", { for: "s-pw", text: "Mot de passe (12 caractères minimum)" }), f.pw,
      h("label", { for: "s-pw2", text: "Confirmez le mot de passe" }), f.pw2,
      err, h("div", { class: "hn-actions" }, btn));
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      err.hidden = true;
      if (f.pw.value !== f.pw2.value) { err.textContent = "Les deux mots de passe ne sont pas identiques."; err.hidden = false; return; }
      btn.disabled = true;
      api("POST", "auth/setup", { setupToken: f.token.value, name: f.name.value, email: f.email.value, password: f.pw.value }, { quiet401: true })
        .then(function () { renderLogin("Compte créé. Connectez-vous avec votre e-mail et votre mot de passe.", f.email.value); })
        .catch(function (x) { err.textContent = x.message; err.hidden = false; btn.disabled = false; });
    });
    authShell("Première installation", "Créez le compte du premier administrateur. Cette page disparaît dès qu'un compte existe.", form);
    f.token.focus();
  }

  function renderLogin(notice, email) {
    var err = h("div", { class: "hn-alert", hidden: true, role: "alert" });
    var em = h("input", { id: "l-email", type: "email", autocomplete: "username", required: true, value: email || "" });
    var pw = h("input", { id: "l-pw", type: "password", autocomplete: "current-password", required: true });
    var btn = h("button", { type: "submit", class: "hn-btn hn-btn-primary", text: "Se connecter" });
    var form = h("form", { class: "hn-form", novalidate: true },
      notice ? h("div", { class: "hn-ok", role: "status", text: notice }) : null,
      h("label", { for: "l-email", text: "E-mail" }), em,
      h("label", { for: "l-pw", text: "Mot de passe" }), pw,
      err, h("div", { class: "hn-actions" }, btn));
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      err.hidden = true; btn.disabled = true;
      api("POST", "auth/login", { email: em.value, password: pw.value }, { quiet401: true })
        .then(function (r) { S.csrf = r.csrfToken; return loadSession(); })
        .then(function () { start(); })
        .catch(function (x) { err.textContent = x.message; err.hidden = false; btn.disabled = false; pw.value = ""; pw.focus(); });
    });
    authShell("Espace rédaction", "Accès réservé à l'équipe de HNet Media.", form);
    (email ? pw : em).focus();
  }

  function loadSession() {
    return api("GET", "auth/session", undefined, { quiet401: true }).then(function (r) {
      S.user = r.user; S.csrf = r.csrfToken; S.perms = new Set(r.permissions);
    });
  }
  function ensureMeta() {
    if (S.meta) return Promise.resolve(S.meta);
    return api("GET", "meta").then(function (m) { S.meta = m; return m; });
  }

  /* ───────── Coque (barre, onglets, routage) ───────── */
  function tabsFor() {
    var t = [];
    if (can("article.create") || can("article.edit_own") || can("article.edit_any") || can("article.sponsor")) t.push(["#/articles", "Articles"]);
    if (can("contact.read")) t.push(["#/messages", "Messages"]);
    if (can("subscriber.read") || can("stats.read")) t.push(["#/abonnes", "Abonnés"]);
    if (can("stats.read")) t.push(["#/stats", "Statistiques"]);
    if (can("user.manage")) t.push(["#/comptes", "Comptes"]);
    t.push(["#/compte", "Mon compte"]);
    return t;
  }

  function start() {
    clear(app);
    var tabs = h("div", { class: "hn-tabs-in", role: "navigation", "aria-label": "Sections" });
    var main = h("main", { class: "hn-main", id: "view" });
    app.appendChild(h("div", { class: "hn-bar" }, h("div", { class: "hn-bar-in" },
      h("img", { src: "/assets/logo.png", alt: "HNet Media" }),
      h("span", { class: "hn-bar-title", text: "Espace rédaction" }),
      h("span", { class: "hn-bar-user" }, h("span", { text: S.user.name + " · " + (ROLES[S.user.role] || S.user.role) }),
        h("button", { type: "button", text: "Déconnexion", onclick: logout })))));
    app.appendChild(h("div", { class: "hn-tabs" }, tabs));
    app.appendChild(main);
    tabsFor().forEach(function (t) { tabs.appendChild(h("a", { href: t[0], "data-h": t[0], text: t[1] })); });
    window.removeEventListener("hashchange", route);
    window.addEventListener("hashchange", route);
    if (!location.hash || location.hash === "#") location.hash = tabsFor()[0][0]; else route();
  }

  function logout() {
    if (guard && !guard()) return;
    api("POST", "auth/logout", {}).catch(function () { /* déjà déconnecté */ }).then(function () {
      S.user = null; S.csrf = null; S.perms = new Set(); S.meta = null; guard = null;
      if (cleanup) { cleanup(); cleanup = null; }
      location.hash = "";
      renderLogin("Vous êtes déconnecté.");
    });
  }

  var lastHash = "";
  function route() {
    if (!S.user) return;
    if (guard && !guard()) { location.hash = lastHash; return; }
    guard = null;
    if (cleanup) { cleanup(); cleanup = null; }
    lastHash = location.hash;
    var parts = location.hash.replace(/^#\/?/, "").split("/");
    var view = document.getElementById("view");
    clear(view);
    var first = "#/" + (parts[0] || "");
    Array.prototype.forEach.call(document.querySelectorAll(".hn-tabs a"), function (a) { a.classList.toggle("on", a.getAttribute("data-h") === first); });
    var run;
    if (parts[0] === "articles" && parts[1]) run = function () { return renderArticle(view, parts[1]); };
    else if (parts[0] === "articles") run = function () { return renderArticles(view); };
    else if (parts[0] === "messages") run = function () { return renderMessages(view); };
    else if (parts[0] === "abonnes") run = function () { return renderSubscribers(view); };
    else if (parts[0] === "stats") run = function () { return renderStats(view); };
    else if (parts[0] === "comptes") run = function () { return renderUsers(view); };
    else if (parts[0] === "compte") run = function () { return renderAccount(view); };
    else { location.hash = tabsFor()[0][0]; return; }
    view.appendChild(h("p", { class: "hn-muted", text: "Chargement…" }));
    Promise.resolve().then(run).catch(function (x) {
      if (x && x.status === 401) return;
      clear(view);
      view.appendChild(h("div", { class: "hn-alert", role: "alert", text: (x && x.message) || "Une erreur est survenue." }));
    });
  }

  function heading(title, sub, actions) {
    return h("div", { class: "hn-head" }, h("div", null, h("h1", { class: "hn-h1", text: title }), sub ? h("p", { class: "hn-sub", text: sub, style: "margin:0" }) : null), actions || null);
  }
  function badge(status, sponsored) {
    var cls = status === "publie" ? "badge" : status === "programme" ? "badge badge-scheduled" : "badge badge-draft";
    return h("span", { class: "hn-chips" }, h("span", { class: cls, text: STATUS[status] || status }), sponsored ? h("span", { class: "badge badge-sponsored", text: "Sponsorisé" }) : null);
  }
  function catLabel(slug) {
    var c = S.meta && S.meta.categories.filter(function (x) { return x.slug === slug; })[0];
    return c ? c.label : (slug || "—");
  }

  /* ───────── Articles : liste ───────── */
  function renderArticles(view) {
    return ensureMeta().then(function () {
      var status = h("select", { "aria-label": "Statut" }, h("option", { value: "", text: "Tous les statuts" }),
        Object.keys(STATUS).map(function (k) { return h("option", { value: k, text: STATUS[k] }); }));
      var q = h("input", { type: "search", placeholder: "Rechercher un titre…", "aria-label": "Rechercher" });
      var box = h("div");
      function load() {
        var qs = [];
        if (status.value) qs.push("status=" + encodeURIComponent(status.value));
        if (q.value.trim()) qs.push("q=" + encodeURIComponent(q.value.trim()));
        return api("GET", "articles" + (qs.length ? "?" + qs.join("&") : "")).then(function (r) {
          clear(box);
          if (!r.items.length) {
            box.appendChild(h("div", { class: "empty-state" }, h("div", { class: "es-icon", text: "📰" }), h("h3", { text: "Aucun article" }),
              h("p", { text: can("article.create") ? "Créez votre premier article avec le bouton « Nouvel article »." : "Aucun article ne correspond à votre recherche." })));
            return;
          }
          var tbl = h("table", { class: "hn-table stack" },
            h("thead", null, h("tr", null, ["Titre", "Statut", "Rubrique", "Auteur", "Langues", "Modifié"].map(function (c) { return h("th", { text: c }); }))),
            h("tbody", null, r.items.map(function (a) {
              return h("tr", null,
                h("td", { "data-l": "Titre" }, h("a", { class: "hn-link", href: "#/articles/" + encodeURIComponent(a.id), text: a.title || "(sans titre)" })),
                h("td", { "data-l": "Statut" }, badge(a.status, a.sponsored)),
                h("td", { "data-l": "Rubrique", text: catLabel(a.category) }),
                h("td", { "data-l": "Auteur", text: a.author || "—" }),
                h("td", { "data-l": "Langues", text: (a.langs || []).join(", ").toUpperCase() || "—" }),
                h("td", { "data-l": "Modifié", class: "hn-muted", text: fmt(a.updated_at) }));
            })));
          box.appendChild(tbl);
        });
      }
      var newBtn = can("article.create") ? h("button", { type: "button", class: "hn-btn hn-btn-primary", text: "+ Nouvel article", onclick: createArticle }) : null;
      function createArticle() {
        ask("Nouvel article", [
          { name: "title", label: "Titre", required: true, max: 300 },
          { name: "category", label: "Rubrique", type: "select", value: "", options: [["", "— À choisir plus tard —"]].concat(S.meta.categories.map(function (c) { return [c.slug, c.label]; })) },
          { name: "type", label: "Type de contenu", type: "select", value: "information", options: TYPES },
        ], { submit: "Créer le brouillon" }).then(function (v) {
          if (!v) return;
          api("POST", "articles", { title: v.title, category: v.category || undefined, type: v.type }).then(function (r) {
            location.hash = "#/articles/" + encodeURIComponent(r.article.id);
          }).catch(function (x) { toast(x.message, true); });
        });
      }
      status.addEventListener("change", load);
      q.addEventListener("input", debounce(load, 300));
      clear(view);
      view.appendChild(heading("Articles", "Brouillons, articles programmés et publiés.", newBtn));
      view.appendChild(h("div", { class: "hn-filters" }, q, status));
      view.appendChild(box);
      return load();
    });
  }

  /* ───────── Articles : éditeur ───────── */
  function renderArticle(view, id) {
    return Promise.all([ensureMeta(), api("GET", "articles/" + encodeURIComponent(id))]).then(function (res) {
      var meta = res[0];
      var a = res[1].article;
      var rights = a.rights;
      var editable = rights.edit;
      var cur = a.originalLang || "fr";
      var dirty = false, imgDirty = false;
      var tr = {};
      LANGS.forEach(function (l) {
        var t = a.translations[l[0]] || {};
        tr[l[0]] = { title: t.title || "", kicker: t.kicker || "", excerpt: t.excerpt || "", content: t.content || "", seoTitle: t.seo_title || "", seoDescription: t.seo_description || "", reviewed: !!t.reviewed };
      });
      var sources = (a.sources || []).map(function (s) { return { name: s.name, url: s.url || "", description: s.description || "" }; });
      var draftKey = "hnet-brouillon-" + a.id;

      function markDirty() { dirty = true; saveBtn && (saveBtn.disabled = !editable); }

      /* champs */
      var inp = function (props) { return h("input", Object.assign({ type: "text", disabled: !editable, oninput: markDirty }, props)); };
      var f = {
        title: inp({ id: "a-title", maxlength: 300, "aria-label": "Titre", style: "font-family:'Playfair Display',serif;font-size:20px;font-weight:700" }),
        kicker: inp({ id: "a-kicker", maxlength: 120 }),
        excerpt: h("textarea", { id: "a-excerpt", maxlength: 600, rows: 3, disabled: !editable, oninput: markDirty }),
        seoTitle: inp({ id: "a-seot", maxlength: 120 }),
        seoDesc: h("textarea", { id: "a-seod", maxlength: 300, rows: 2, disabled: !editable, oninput: markDirty }),
        reviewed: h("input", { type: "checkbox", id: "a-rev", disabled: !can("translation.edit"), onchange: markDirty }),
        slug: inp({ id: "a-slug", maxlength: 120 }),
        category: h("select", { id: "a-cat", disabled: !editable, onchange: markDirty }, h("option", { value: "", text: "— Choisir —" }), meta.categories.map(function (c) { return h("option", { value: c.slug, text: c.label }); })),
        type: h("select", { id: "a-type", disabled: !editable, onchange: markDirty }, TYPES.map(function (t) { return h("option", { value: t[0], text: t[1] }); })),
        author: h("select", { id: "a-author", disabled: !editable, onchange: markDirty }, h("option", { value: "", text: "— Aucune fiche auteur —" }), meta.authors.map(function (x) { return h("option", { value: x.id, text: x.name }); })),
        signature: inp({ id: "a-sign", maxlength: 150 }),
        tags: inp({ id: "a-tags", placeholder: "élections, CEP, Port-au-Prince" }),
        imgUrl: inp({ id: "a-iurl", type: "url", placeholder: "https://…", oninput: function () { markDirty(); imgDirty = true; } }),
        imgAlt: inp({ id: "a-ialt", maxlength: 300, oninput: function () { markDirty(); imgDirty = true; } }),
        imgCap: inp({ id: "a-icap", maxlength: 300, oninput: function () { markDirty(); imgDirty = true; } }),
        imgCred: inp({ id: "a-icred", maxlength: 150, oninput: function () { markDirty(); imgDirty = true; } }),
        featured: h("input", { type: "checkbox", id: "a-feat", disabled: !rights.publish, onchange: markDirty }),
        urgent: h("input", { type: "checkbox", id: "a-urg", disabled: !rights.publish, onchange: markDirty }),
        recommended: h("input", { type: "checkbox", id: "a-rec", disabled: !rights.publish, onchange: markDirty }),
      };
      f.slug.value = a.slug; f.category.value = a.category || ""; f.type.value = a.type;
      f.author.value = a.authorId || ""; f.signature.value = a.authorName || "";
      f.tags.value = (a.tags || []).map(function (t) { return t.label; }).join(", ");
      if (a.mainImage) { f.imgUrl.value = a.mainImage.url; f.imgAlt.value = a.mainImage.alt || ""; f.imgCap.value = a.mainImage.caption || ""; f.imgCred.value = a.mainImage.credit || ""; }
      f.featured.checked = a.featured; f.urgent.checked = a.urgent; f.recommended.checked = a.recommended;

      var langTabs = h("div", { class: "hn-tabsl", role: "tablist", "aria-label": "Langue du texte" });
      var langHint = h("p", { class: "hn-hint" });
      var revWrap = h("div", { class: "hn-checks" }, h("label", { for: "a-rev" }, f.reviewed, "Traduction relue et validée par un humain"));
      var edRoot = h("div", { id: "a-editor" });
      var ed = null;

      function saveCur() {
        var t = tr[cur];
        t.title = f.title.value; t.kicker = f.kicker.value; t.excerpt = f.excerpt.value;
        t.seoTitle = f.seoTitle.value; t.seoDescription = f.seoDesc.value; t.reviewed = f.reviewed.checked;
        t.content = ed ? ed.getHTML() : t.content;
      }
      var langReady = false;
      function showLang(l) {
        if (langReady) saveCur(); // jamais à l'ouverture : le formulaire est encore vide
        langReady = true;
        cur = l;
        var t = tr[l];
        f.title.value = t.title; f.kicker.value = t.kicker; f.excerpt.value = t.excerpt;
        f.seoTitle.value = t.seoTitle; f.seoDesc.value = t.seoDescription; f.reviewed.checked = t.reviewed;
        if (ed) ed.setHTML(t.content);
        var orig = l === (a.originalLang || "fr");
        revWrap.hidden = orig;
        langHint.textContent = orig ? "Version d'origine de l'article." :
          (t.title ? "Traduction : elle n'est publiée sur le site qu'une fois relue et validée. Aucune traduction automatique." : "Pas encore de traduction : saisissez un titre et un texte pour la créer. Elle ne sera publiée qu'une fois relue et validée.");
        Array.prototype.forEach.call(langTabs.children, function (b) { b.classList.toggle("on", b.getAttribute("data-l") === l); b.setAttribute("aria-selected", String(b.getAttribute("data-l") === l)); });
      }
      LANGS.forEach(function (l) {
        langTabs.appendChild(h("button", { type: "button", role: "tab", "data-l": l[0], text: l[1], onclick: function () { showLang(l[0]); } }));
      });

      function collect() {
        saveCur();
        var translations = {};
        LANGS.forEach(function (l) {
          var t = tr[l[0]];
          if (t.title.trim()) translations[l[0]] = { title: t.title, kicker: t.kicker, excerpt: t.excerpt, content: t.content, seoTitle: t.seoTitle, seoDescription: t.seoDescription, reviewed: t.reviewed };
        });
        var body = {
          slug: f.slug.value.trim(), type: f.type.value, category: f.category.value || null,
          authorId: f.author.value || null, authorName: f.signature.value.trim() || null,
          tags: f.tags.value.split(",").map(function (s) { return s.trim(); }).filter(Boolean),
          sources: sources.filter(function (s) { return s.name.trim(); }).map(function (s) { return { name: s.name.trim(), url: s.url.trim() || undefined, description: s.description || undefined }; }),
          translations: translations,
        };
        if (rights.publish) { body.featured = f.featured.checked; body.urgent = f.urgent.checked; body.recommended = f.recommended.checked; }
        if (imgDirty) body.mainImage = f.imgUrl.value.trim() ? { url: f.imgUrl.value.trim(), alt: f.imgAlt.value.trim(), caption: f.imgCap.value.trim(), credit: f.imgCred.value.trim() } : null;
        return body;
      }

      function refreshHead() {
        clear(statusBox);
        statusBox.appendChild(h("div", { style: "margin-bottom:8px" }, badge(a.status, a.sponsored)));
        statusBox.appendChild(h("p", { class: "hn-muted", text: a.publishedAt ? (a.status === "programme" ? "Publication prévue le " : "Publié le ") + fmt(a.publishedAt) : "Pas encore de date de publication." }));
        statusBox.appendChild(h("p", { class: "hn-muted", text: "Dernière modification : " + fmt(a.updatedAt) }));
      }

      function save(quiet) {
        if (!editable) return Promise.resolve(false);
        return api("PUT", "articles/" + encodeURIComponent(a.id), collect()).then(function (r) {
          a = r.article; rights = a.rights; dirty = false; imgDirty = false; saveBtn.disabled = true;
          try { localStorage.removeItem(draftKey); } catch (e) { /* ignoré */ }
          f.slug.value = a.slug; refreshHead();
          if (!quiet) toast("Article enregistré.");
          return true;
        }).catch(function (x) { toast(x.message, true); return false; });
      }

      function changeStatus(status, extra, okMsg) {
        return (dirty ? save(true) : Promise.resolve(true)).then(function (ok) {
          if (!ok) return;
          return api("POST", "articles/" + encodeURIComponent(a.id) + "/status", Object.assign({ status: status }, extra || {})).then(function (r) {
            a = r.article; rights = a.rights; refreshHead(); renderActions(); renderCorrections();
            var msg = okMsg;
            if (status === "publie" || status === "programme") msg += r.article.rebuildTriggered ? " Mise à jour du site demandée." : " (Mise à jour automatique du site non configurée.)";
            toast(msg);
          }).catch(function (x) { toast(x.message, true); });
        });
      }

      var statusBox = h("div");
      var corrBox = h("div");
      var actionsBox = h("div", { class: "hn-actions", style: "margin-top:12px" });
      var saveBtn = h("button", { type: "button", class: "hn-btn hn-btn-primary", text: "Enregistrer", disabled: true, onclick: function () { save(false); } });
      function renderActions() {
        clear(actionsBox);
        if (editable) actionsBox.appendChild(saveBtn);
        if (rights.publish && a.status !== "publie") actionsBox.appendChild(h("button", { type: "button", class: "hn-btn hn-btn-navy", text: "Publier maintenant", onclick: function () {
          confirmBox("Cet article sera publié immédiatement, sous la signature indiquée.", { title: "Publier l'article ?", confirm: "Publier" }).then(function (ok) { if (ok) changeStatus("publie", null, "Article publié."); });
        } }));
        if (rights.publish && a.status !== "publie") actionsBox.appendChild(h("button", { type: "button", class: "hn-btn hn-btn-ghost", text: "Programmer…", onclick: function () {
          var soon = new Date(Date.now() + 3600000); soon.setMinutes(0, 0, 0);
          var local = new Date(soon.getTime() - soon.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
          ask("Programmer la publication", [{ name: "when", label: "Date et heure de publication", type: "datetime-local", value: local, required: true }], { submit: "Programmer" }).then(function (v) {
            if (v) changeStatus("programme", { publishedAt: new Date(v.when).toISOString() }, "Publication programmée.");
          });
        } }));
        if (rights.publish && a.status === "publie") actionsBox.appendChild(h("button", { type: "button", class: "hn-btn hn-btn-ghost", text: "Dépublier (brouillon)", onclick: function () {
          confirmBox("L'article ne sera plus visible sur le site après la prochaine mise à jour.", { title: "Dépublier ?", confirm: "Dépublier" }).then(function (ok) { if (ok) changeStatus("brouillon", null, "Article repassé en brouillon."); });
        } }));
        if (rights.publish && a.status === "programme") actionsBox.appendChild(h("button", { type: "button", class: "hn-btn hn-btn-ghost", text: "Annuler la programmation", onclick: function () { changeStatus("brouillon", null, "Programmation annulée."); } }));
        if (rights.archive && a.status !== "archive") actionsBox.appendChild(h("button", { type: "button", class: "hn-btn hn-btn-ghost", text: "Archiver", onclick: function () {
          confirmBox("L'article sera retiré du site mais conservé.", { title: "Archiver ?", confirm: "Archiver" }).then(function (ok) { if (ok) changeStatus("archive", null, "Article archivé."); });
        } }));
        actionsBox.appendChild(h("button", { type: "button", class: "hn-btn hn-btn-ghost", text: "Aperçu", onclick: preview }));
      }

      function preview() {
        saveCur();
        var t = tr[cur];
        openDialog(function (box, close) {
          var body = h("div", { class: "article-body" });
          body.innerHTML = ed.getHTML(); // HTML déjà normalisé par le schéma de l'éditeur
          box.appendChild(h("p", { class: "hn-muted", text: "Aperçu — présentation indicative (" + cur.toUpperCase() + ")" }));
          if (t.kicker) box.appendChild(h("p", { class: "hn-muted", style: "text-transform:uppercase;letter-spacing:1px;margin-top:10px", text: t.kicker }));
          box.appendChild(h("h1", { style: "font-family:'Playfair Display',serif;font-size:26px;line-height:1.25;color:var(--navy);margin:6px 0 10px", text: t.title || "(sans titre)" }));
          if (t.excerpt) box.appendChild(h("p", { style: "font-size:15px;color:var(--gray-dk);line-height:1.7;margin-bottom:16px", text: t.excerpt }));
          box.appendChild(body);
          box.appendChild(h("div", { class: "hn-actions" }, h("button", { type: "button", class: "hn-btn hn-btn-navy", text: "Fermer", onclick: function () { close(null); } })));
        }, true);
      }

      /* sources */
      var srcBox = h("div", { class: "hn-rows" });
      function renderSources() {
        clear(srcBox);
        sources.forEach(function (s, i) {
          srcBox.appendChild(h("div", { class: "row" },
            h("input", { type: "text", placeholder: "Nom de la source", "aria-label": "Nom de la source", maxlength: 200, value: s.name, disabled: !editable, oninput: function (e) { s.name = e.target.value; markDirty(); } }),
            h("input", { type: "url", placeholder: "https://… (facultatif)", "aria-label": "Lien de la source", maxlength: 2000, value: s.url, disabled: !editable, oninput: function (e) { s.url = e.target.value; markDirty(); } }),
            editable ? h("button", { type: "button", class: "hn-btn hn-btn-ghost hn-btn-sm", "aria-label": "Retirer cette source", text: "✕", onclick: function () { sources.splice(i, 1); markDirty(); renderSources(); } }) : null));
        });
        if (editable) srcBox.appendChild(h("button", { type: "button", class: "hn-btn hn-btn-ghost hn-btn-sm", text: "+ Ajouter une source", onclick: function () { sources.push({ name: "", url: "", description: "" }); renderSources(); } }));
      }

      /* assemblage de la page */
      var label = function (text, forId) { return h("label", { for: forId, text: text }); };
      var left = h("div", null,
        h("div", { class: "hn-card hn-form" },
          h("div", { class: "hn-tabsl-wrap" }, langTabs), langHint,
          label("Titre", "a-title"), f.title,
          h("div", { class: "hn-grid2" }, h("div", null, label("Surtitre (facultatif)", "a-kicker"), f.kicker)),
          label("Chapeau (résumé de 2 à 3 phrases)", "a-excerpt"), f.excerpt,
          revWrap,
          label("Texte de l'article", "a-editor"), edRoot,
          h("details", { style: "margin-top:16px" }, h("summary", { style: "cursor:pointer;font-size:13px;font-weight:700;color:var(--navy)", text: "Référencement (facultatif)" }),
            label("Titre pour les moteurs de recherche (60 caractères conseillés)", "a-seot"), f.seoTitle,
            label("Description pour les moteurs de recherche (150 caractères conseillés)", "a-seod"), f.seoDesc)),
        h("div", { class: "hn-card hn-form" }, h("h2", { text: "Sources" }), h("p", { class: "hn-hint", style: "margin:0 0 10px", text: "Indiquez vos sources : elles apparaissent sous l'article." }), srcBox),
        corrBox);

      function renderCorrections() { clear(corrBox); corrBox.appendChild(correctionsCard()); }
      function correctionsCard() {
        var card = h("div", { class: "hn-card hn-form" }, h("h2", { text: "Corrections publiques" }));
        if (a.corrections.length) a.corrections.forEach(function (c) { card.appendChild(h("div", { class: "correction-note" }, h("strong", { text: fmt(c.corrected_at) + " — " }), c.text)); });
        else card.appendChild(h("p", { class: "hn-muted", text: "Aucune correction publiée." }));
        if (rights.correct && a.status === "publie") {
          var ta = h("textarea", { rows: 3, maxlength: 1000, "aria-label": "Texte de la correction", placeholder: "Ex. : La date du scrutin a été corrigée (30 au lieu de 13)." });
          card.appendChild(ta);
          card.appendChild(h("div", { class: "hn-actions", style: "margin-top:10px" }, h("button", { type: "button", class: "hn-btn hn-btn-navy", text: "Publier la correction", onclick: function () {
            if (!ta.value.trim()) return toast("Saisissez le texte de la correction.", true);
            api("POST", "articles/" + encodeURIComponent(a.id) + "/corrections", { text: ta.value }).then(function (r) {
              a = r.article; toast("Correction publiée."); renderCorrections();
            }).catch(function (x) { toast(x.message, true); });
          } })));
        }
        return card;
      }

      var sponsorBox = null;
      if (rights.sponsor) {
        var sp = h("input", { type: "checkbox", id: "a-sp", checked: a.sponsored, onchange: function () {
          api("POST", "articles/" + encodeURIComponent(a.id) + "/sponsored", { sponsored: sp.checked }).then(function (r) { a = r.article; refreshHead(); toast(a.sponsored ? "Mention « Sponsorisé » activée." : "Mention « Sponsorisé » retirée."); })
            .catch(function (x) { sp.checked = !sp.checked; toast(x.message, true); });
        } });
        sponsorBox = h("div", { class: "hn-checks" }, h("label", { for: "a-sp" }, sp, "Contenu sponsorisé (affiche la mention)"));
      }

      var right = h("div", { class: "hn-side" },
        h("div", { class: "hn-card hn-form" }, h("h2", { text: "Publication" }), statusBox, actionsBox, sponsorBox,
          h("div", { class: "correction-note", style: "margin-top:14px", text: "Pour l'instant, le site public est encore généré depuis les fichiers du dépôt : un article publié ici n'y apparaîtra qu'une fois le build relié à la base (prochaine étape)." })),
        h("div", { class: "hn-card hn-form" }, h("h2", { text: "Classement" }),
          label("Rubrique", "a-cat"), f.category, label("Type de contenu", "a-type"), f.type,
          label("Auteur", "a-author"), f.author, label("Ou signature libre", "a-sign"), f.signature,
          label("Adresse (slug)", "a-slug"), f.slug,
          label("Mots-clés (séparés par des virgules)", "a-tags"), f.tags,
          rights.publish ? h("div", { class: "hn-checks" },
            h("label", { for: "a-feat" }, f.featured, "À la une"), h("label", { for: "a-urg" }, f.urgent, "Urgent"), h("label", { for: "a-rec" }, f.recommended, "Recommandé")) : null),
        h("div", { class: "hn-card hn-form" }, h("h2", { text: "Image principale" }),
          label("Adresse de l'image (https://…)", "a-iurl"), f.imgUrl,
          label("Texte alternatif (obligatoire)", "a-ialt"), f.imgAlt,
          label("Légende", "a-icap"), f.imgCap, label("Crédit photo", "a-icred"), f.imgCred,
          h("p", { class: "hn-hint", text: "Le téléversement de fichiers viendra plus tard : pour l'instant, indiquez l'adresse d'une image déjà en ligne." })),
        rights.delete ? h("div", { class: "hn-card" }, h("button", { type: "button", class: "hn-btn hn-btn-danger", text: "Supprimer définitivement", onclick: function () {
          confirmBox("Cette action est irréversible : l'article, ses traductions et ses corrections seront effacés.", { title: "Supprimer l'article ?", confirm: "Supprimer", danger: true, typed: "SUPPRIMER" }).then(function (ok) {
            if (!ok) return;
            api("DELETE", "articles/" + encodeURIComponent(a.id)).then(function () { dirty = false; toast("Article supprimé."); location.hash = "#/articles"; }).catch(function (x) { toast(x.message, true); });
          });
        } })) : null);

      clear(view);
      view.appendChild(h("p", { class: "hn-muted" }, h("a", { href: "#/articles", text: "← Tous les articles" })));
      if (!editable) view.appendChild(h("div", { class: "correction-note", text: "Lecture seule : vous n'avez pas le droit de modifier cet article dans son état actuel." }));
      view.appendChild(h("div", { class: "hn-layout" }, left, right));

      ed = window.HNetEditor.create(edRoot, { html: "", ask: ask, onChange: function () { dirty = true; if (editable) saveBtn.disabled = false; } });
      if (!editable) ed.editor.setEditable(false);
      showLang(cur);
      renderSources(); refreshHead(); renderActions(); renderCorrections();

      /* brouillon local de secours (si la connexion ou l'onglet est perdu) */
      try {
        var saved = JSON.parse(localStorage.getItem(draftKey) || "null");
        if (saved && editable && saved.at > new Date(a.updatedAt).getTime() && saved.tr) {
          confirmBox("Une version de cet article enregistrée sur cet appareil est plus récente que celle du serveur (" + new Date(saved.at).toLocaleString("fr-FR") + "). La récupérer ?", { title: "Brouillon local trouvé", confirm: "Récupérer" }).then(function (ok) {
            if (ok) { tr = saved.tr; showLang(cur); markDirty(); } else { try { localStorage.removeItem(draftKey); } catch (e) { /* ignoré */ } }
          });
        }
      } catch (e) { /* stockage indisponible */ }
      var timer = setInterval(function () {
        if (!dirty || !editable) return;
        try { saveCur(); localStorage.setItem(draftKey, JSON.stringify({ at: Date.now(), tr: tr })); } catch (e) { /* ignoré */ }
      }, 5000);

      function beforeUnload(e) { if (dirty) { e.preventDefault(); e.returnValue = ""; } }
      window.addEventListener("beforeunload", beforeUnload);
      guard = function () { return !dirty || window.confirm("Des modifications n'ont pas été enregistrées. Quitter quand même ?"); };
      cleanup = function () { clearInterval(timer); window.removeEventListener("beforeunload", beforeUnload); if (ed) ed.destroy(); };
    });
  }

  /* ───────── Messages de contact ───────── */
  function renderMessages(view) {
    var filter = h("select", { "aria-label": "Statut" }, [["", "Tous"], ["nouveau", "Nouveaux"], ["lu", "Lus"], ["traite", "Traités"], ["spam", "Indésirables"]].map(function (o) { return h("option", { value: o[0], text: o[1] }); }));
    var box = h("div");
    function load() {
      return api("GET", "contact-messages" + (filter.value ? "?status=" + filter.value : "")).then(function (r) {
        clear(box);
        if (!r.items.length) { box.appendChild(h("div", { class: "empty-state" }, h("div", { class: "es-icon", text: "✉️" }), h("h3", { text: "Aucun message" }), h("p", { text: "Les messages envoyés depuis la page Contact apparaîtront ici." }))); return; }
        r.items.forEach(function (m) {
          var body = h("div", { class: "hn-msg-b", hidden: true });
          body.appendChild(document.createTextNode(m.message));
          var actions = h("div", { class: "hn-actions", style: "padding:0 14px 14px", hidden: true });
          function setStatus(s) { api("PATCH", "contact-messages/" + m.id, { status: s }).then(function () { toast("Message marqué : " + s + "."); load(); }).catch(function (x) { toast(x.message, true); }); }
          if (can("contact.manage")) {
            [["lu", "Marquer lu"], ["traite", "Marquer traité"], ["spam", "Indésirable"]].forEach(function (o) { if (m.status !== o[0]) actions.appendChild(h("button", { type: "button", class: "hn-btn hn-btn-ghost hn-btn-sm", text: o[1], onclick: function () { setStatus(o[0]); } })); });
          }
          actions.appendChild(h("a", { class: "hn-btn hn-btn-navy hn-btn-sm", href: "mailto:" + encodeURIComponent(m.email).replace(/%40/g, "@") + "?subject=" + encodeURIComponent("Re: " + (m.subject || m.category)), text: "Répondre par e-mail" }));
          var head = h("div", { class: "hn-msg-h", role: "button", tabindex: "0", "aria-expanded": "false" },
            h("div", null, h("strong", { text: m.name }), " ", h("span", { class: "hn-muted", text: "<" + m.email + ">" }), h("div", { class: "hn-muted", text: m.category + (m.subject ? " · " + m.subject : "") + " · " + fmt(m.created_at) })),
            h("span", { class: "badge " + (m.status === "nouveau" ? "" : "badge-draft"), text: m.status }));
          function toggle() { var open = body.hidden; body.hidden = !open; actions.hidden = !open; head.setAttribute("aria-expanded", String(open)); }
          head.addEventListener("click", toggle);
          head.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
          box.appendChild(h("div", { class: "hn-msg" + (m.status === "nouveau" ? " new" : "") }, head, body, actions));
        });
      });
    }
    filter.addEventListener("change", load);
    clear(view);
    view.appendChild(heading("Messages", "Messages reçus par le formulaire de contact."));
    view.appendChild(h("div", { class: "hn-filters" }, filter));
    view.appendChild(box);
    return load();
  }

  /* ───────── Abonnés ───────── */
  function renderSubscribers(view) {
    clear(view);
    view.appendChild(heading("Abonnés à la newsletter", "Inscriptions avec double confirmation."));
    var statsBox = h("div", { class: "hn-card" });
    view.appendChild(statsBox);
    var jobs = [];
    if (can("stats.read")) jobs.push(api("GET", "subscribers/stats").then(function (r) {
      var c = r.counts || {};
      statsBox.appendChild(h("h2", { text: "Répartition" }));
      statsBox.appendChild(h("div", { class: "hn-chips" }, [["confirme", "Confirmés"], ["en_attente", "En attente de confirmation"], ["desinscrit", "Désinscrits"]].map(function (o) { return h("span", { class: "tag", text: o[1] + " : " + (c[o[0]] || 0) }); })));
      statsBox.appendChild(h("p", { class: "hn-hint", text: "Seuls les abonnés confirmés reçoivent la newsletter. Ces chiffres sont internes : rien n'est affiché publiquement." }));
    }));
    if (can("subscriber.read")) {
      if (can("subscriber.export")) statsBox.appendChild(h("div", { class: "hn-actions", style: "margin-top:12px" }, h("a", { class: "hn-btn hn-btn-navy hn-btn-sm", href: "/api/admin/subscribers/export", text: "Exporter les abonnés confirmés (CSV)" })));
      jobs.push(api("GET", "subscribers").then(function (r) {
        if (!r.items.length) { view.appendChild(h("div", { class: "empty-state" }, h("div", { class: "es-icon", text: "📬" }), h("h3", { text: "Aucun abonné" }), h("p", { text: "Les inscriptions apparaîtront ici dès que la newsletter sera activée." }))); return; }
        view.appendChild(h("table", { class: "hn-table stack" },
          h("thead", null, h("tr", null, ["E-mail", "Statut", "Langue", "Inscrit le", "Confirmé le"].map(function (c) { return h("th", { text: c }); }))),
          h("tbody", null, r.items.map(function (s) {
            return h("tr", null, h("td", { "data-l": "E-mail", text: s.email }), h("td", { "data-l": "Statut", text: s.status }), h("td", { "data-l": "Langue", text: s.lang.toUpperCase() }),
              h("td", { "data-l": "Inscrit le", class: "hn-muted", text: fmt(s.created_at) }), h("td", { "data-l": "Confirmé le", class: "hn-muted", text: fmt(s.confirmed_at) }));
          }))));
      }));
    }
    return Promise.all(jobs);
  }

  /* ───────── Statistiques ───────── */
  function renderStats(view) {
    var days = h("select", { "aria-label": "Période" }, [["7", "7 jours"], ["30", "30 jours"], ["90", "90 jours"]].map(function (o) { return h("option", { value: o[0], text: o[1] }); }));
    days.value = "30";
    var box = h("div");
    function load() {
      return api("GET", "stats/views?days=" + days.value).then(function (r) {
        clear(box);
        if (!r.perDay.length) { box.appendChild(h("div", { class: "empty-state" }, h("div", { class: "es-icon", text: "📊" }), h("h3", { text: "Pas encore de données" }), h("p", { text: "Les lectures d'articles publiés seront comptées ici, sans aucune donnée personnelle." }))); return; }
        var max = Math.max.apply(null, r.perDay.map(function (d) { return d.views; }));
        box.appendChild(h("div", { class: "hn-card" }, h("h2", { text: "Lectures par jour" }), h("div", { class: "hn-bars" }, r.perDay.map(function (d) {
          return h("div", { class: "b" }, h("span", { class: "hn-muted", text: new Date(d.day).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) }), h("i", { style: "width:" + Math.max(2, Math.round(d.views / max * 100)) + "%" }), h("span", { text: d.views }));
        }))));
        box.appendChild(h("div", { class: "hn-card" }, h("h2", { text: "Articles les plus lus" }), h("table", { class: "hn-table" }, h("tbody", null, r.topArticles.map(function (t) {
          return h("tr", null, h("td", { text: t.title || t.slug }), h("td", { text: t.views, style: "text-align:right;font-weight:700" }));
        })))));
      });
    }
    days.addEventListener("change", load);
    clear(view);
    view.appendChild(heading("Statistiques", "Lectures d'articles. Les robots et les visiteurs qui refusent le suivi ne sont pas comptés ; aucune adresse IP n'est conservée."));
    view.appendChild(h("div", { class: "hn-filters" }, days));
    view.appendChild(box);
    return load();
  }

  /* ───────── Comptes ───────── */
  function renderUsers(view) {
    return ensureMeta().then(function () {
      var roleOpts = S.meta.roles.map(function (r) { return [r.code, r.label]; });
      var box = h("div");
      function load() {
        return api("GET", "users").then(function (r) {
          clear(box);
          box.appendChild(h("table", { class: "hn-table stack" },
            h("thead", null, h("tr", null, ["Nom", "E-mail", "Rôle", "État", "Dernière connexion", ""].map(function (c) { return h("th", { text: c }); }))),
            h("tbody", null, r.items.map(function (u) {
              var locked = u.locked_until && new Date(u.locked_until) > new Date();
              return h("tr", null,
                h("td", { "data-l": "Nom", text: u.name }), h("td", { "data-l": "E-mail", text: u.email }), h("td", { "data-l": "Rôle", text: ROLES[u.role] || u.role }),
                h("td", { "data-l": "État", text: !u.active ? "Désactivé" : locked ? "Verrouillé" : "Actif" }),
                h("td", { "data-l": "Dernière connexion", class: "hn-muted", text: fmt(u.last_login_at) }),
                h("td", null, h("button", { type: "button", class: "hn-btn hn-btn-ghost hn-btn-sm", text: "Modifier", onclick: function () { edit(u, locked); } })));
            }))));
        });
      }
      function edit(u, locked) {
        ask("Modifier " + u.name, [
          { name: "role", label: "Rôle", type: "select", value: u.role, options: roleOpts },
          { name: "active", label: "État du compte", type: "select", value: u.active ? "1" : "0", options: [["1", "Actif"], ["0", "Désactivé (ne peut plus se connecter)"]] },
          { name: "unlock", label: "Compte verrouillé ?", type: "select", value: "0", options: [["0", locked ? "Laisser verrouillé" : "Non verrouillé"], ["1", "Déverrouiller maintenant"]] },
          { name: "password", label: "Nouveau mot de passe (laisser vide pour ne pas le changer)", type: "password", autocomplete: "new-password" },
        ], { submit: "Enregistrer", intro: "Un changement de rôle, la désactivation ou un nouveau mot de passe déconnecte immédiatement la personne." }).then(function (v) {
          if (!v) return;
          var body = { role: v.role, active: v.active === "1", unlock: v.unlock === "1" };
          if (v.password) body.password = v.password;
          api("PATCH", "users/" + u.id, body).then(function () { toast("Compte mis à jour."); load(); }).catch(function (x) { toast(x.message, true); });
        });
      }
      function create() {
        ask("Nouveau compte", [
          { name: "name", label: "Nom", required: true, max: 100 },
          { name: "email", label: "E-mail", type: "email", required: true, autocomplete: "off" },
          { name: "role", label: "Rôle", type: "select", value: "journaliste", options: roleOpts },
          { name: "password", label: "Mot de passe provisoire (12 caractères minimum)", type: "password", required: true, autocomplete: "new-password" },
        ], { submit: "Créer le compte", intro: "Communiquez le mot de passe de vive voix ou par un canal sûr ; la personne pourra le changer dans « Mon compte »." }).then(function (v) {
          if (!v) return;
          api("POST", "users", v).then(function () { toast("Compte créé."); load(); }).catch(function (x) { toast(x.message, true); });
        });
      }
      clear(view);
      view.appendChild(heading("Comptes", "Chaque personne a le rôle qui lui donne le minimum de droits nécessaires.", h("button", { type: "button", class: "hn-btn hn-btn-primary", text: "+ Nouveau compte", onclick: create })));
      view.appendChild(h("div", { class: "hn-card" }, h("h2", { text: "Droits par rôle" }), h("ul", { style: "list-style:none;font-size:13px;line-height:1.8" }, S.meta.roles.map(function (r) { return h("li", null, h("strong", { text: r.label + " : " }), r.description); }))));
      view.appendChild(box);
      return load();
    });
  }

  /* ───────── Mon compte ───────── */
  function renderAccount(view) {
    var err = h("div", { class: "hn-alert", hidden: true, role: "alert" });
    var f = {
      cur: h("input", { id: "p-cur", type: "password", autocomplete: "current-password", required: true }),
      pw: h("input", { id: "p-new", type: "password", autocomplete: "new-password", required: true }),
      pw2: h("input", { id: "p-new2", type: "password", autocomplete: "new-password", required: true }),
    };
    var form = h("form", { class: "hn-form", novalidate: true },
      h("label", { for: "p-cur", text: "Mot de passe actuel" }), f.cur,
      h("label", { for: "p-new", text: "Nouveau mot de passe (12 caractères minimum)" }), f.pw,
      h("label", { for: "p-new2", text: "Confirmez le nouveau mot de passe" }), f.pw2,
      err, h("div", { class: "hn-actions" }, h("button", { type: "submit", class: "hn-btn hn-btn-primary", text: "Changer le mot de passe" })));
    form.addEventListener("submit", function (e) {
      e.preventDefault(); err.hidden = true;
      if (f.pw.value !== f.pw2.value) { err.textContent = "Les deux mots de passe ne sont pas identiques."; err.hidden = false; return; }
      api("POST", "auth/password", { current: f.cur.value, password: f.pw.value }).then(function (r) { toast(r.message || "Mot de passe modifié."); form.reset(); })
        .catch(function (x) { err.textContent = x.message; err.hidden = false; });
    });
    clear(view);
    view.appendChild(heading("Mon compte", S.user.name + " · " + S.user.email + " · " + (ROLES[S.user.role] || S.user.role)));
    view.appendChild(h("div", { class: "hn-card", style: "max-width:520px" }, h("h2", { text: "Mot de passe" }), form,
      h("p", { class: "hn-hint", text: "Après un changement, vos autres sessions sont déconnectées." })));
    return Promise.resolve();
  }

  /* ───────── Démarrage ───────── */
  api("GET", "auth/session", undefined, { quiet401: true })
    .then(function (r) { S.user = r.user; S.csrf = r.csrfToken; S.perms = new Set(r.permissions); start(); })
    .catch(function (x) {
      if (x.status === 401) { if (x.data && x.data.needsSetup) renderSetup(); else renderLogin(); return; }
      clear(app);
      app.appendChild(h("div", { class: "hn-auth" }, h("div", { class: "hn-alert", role: "alert", text: x.message || "Service indisponible. Réessayez dans quelques instants." })));
    });
})();
