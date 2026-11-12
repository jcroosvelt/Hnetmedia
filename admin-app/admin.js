/* Espace rédaction HNet Media — interface d'administration (JavaScript sans dépendance).
   Toute donnée affichée passe par textContent (jamais innerHTML), sauf l'aperçu d'article,
   qui n'affiche que du HTML déjà filtré par le schéma de l'éditeur. */
/* Compléments pour les navigateurs intégrés anciens (WebView Android non mis à jour) : l'éditeur de texte
   utilise ces méthodes récentes. Sans effet sur les navigateurs à jour. */
(function () {
  function def(o, name, fn) { if (!o[name]) Object.defineProperty(o, name, { value: fn, configurable: true, writable: true }); }
  def(Array.prototype, "at", function (i) { i = Math.trunc(i) || 0; if (i < 0) i += this.length; return this[i]; });
  def(Array.prototype, "findLast", function (f, th) { for (var i = this.length - 1; i >= 0; i--) if (f.call(th, this[i], i, this)) return this[i]; return undefined; });
  def(Array.prototype, "findLastIndex", function (f, th) { for (var i = this.length - 1; i >= 0; i--) if (f.call(th, this[i], i, this)) return i; return -1; });
  def(String.prototype, "at", function (i) { i = Math.trunc(i) || 0; if (i < 0) i += this.length; return i >= 0 && i < this.length ? this.charAt(i) : undefined; });
  def(String.prototype, "replaceAll", function (s, r) { return s instanceof RegExp ? this.replace(s, r) : this.split(String(s)).join(typeof r === "function" ? r(s) : r); });
  def(Object, "hasOwn", function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); });
  def(window, "structuredClone", function (v) { return JSON.parse(JSON.stringify(v)); });
})();

(function () {
  "use strict";

  var app = document.getElementById("app");
  var S = { csrf: null, user: null, perms: new Set(), meta: null };
  var cleanup = null; // fonction appelée en quittant une vue (éditeur, minuteurs…)
  var guard = null; // fonction () => true si on peut quitter la vue
  var LANGS = [["fr", "Français"], ["en", "English"]];
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
        else if (k === "html") e.innerHTML = v; // uniquement du balisage statique écrit dans ce fichier (icônes)
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
  // Une erreur inattendue de la page est affichée (au lieu de ne rien faire) : plus simple à signaler et à corriger.
  var shownErrors = 0;
  window.addEventListener("error", function (e) {
    if (shownErrors++ < 3 && e && e.message) toast("Erreur de la page : " + String(e.message).slice(0, 140), true);
  });

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
  /* ───────── Notifications push (application Android) ─────────
     L'application appelle window.onFcmToken(jeton) ; on l'enregistre dès qu'une session est ouverte
     et on le retire à la déconnexion. Dans un navigateur ordinaire, rien ne se passe. */
  var fcmToken = window.__fcmToken || null;
  function registerDevice() {
    if (!fcmToken || !S.user || !S.csrf) return;
    api("POST", "devices", { token: fcmToken }, { quiet401: true }).catch(function () { /* nouvel essai au prochain chargement */ });
  }
  window.onFcmToken = function (t) { if (typeof t === "string" && t) { fcmToken = t; registerDevice(); } };
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
      registerDevice();
    });
  }
  // L'éditeur (≈ 440 Ko) n'est téléchargé qu'à l'ouverture d'un article.
  var editorLoading = null;
  function loadEditor() {
    if (window.HNetEditor) return Promise.resolve();
    if (!editorLoading) {
      editorLoading = new Promise(function (resolve, reject) {
        var sc = document.createElement("script");
        sc.src = "/admin/editor.js";
        sc.onload = resolve;
        sc.onerror = function () { editorLoading = null; reject(new Error("Impossible de charger l'éditeur de texte. Vérifiez votre connexion et réessayez.")); };
        document.head.appendChild(sc);
      });
    }
    return editorLoading;
  }
  function ensureMeta() {
    if (S.meta) return Promise.resolve(S.meta);
    return api("GET", "meta").then(function (m) { S.meta = m; return m; });
  }

  /* ───────── Icônes (balisage statique, aucune donnée) ───────── */
  var ICONS = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14c2.5 0 4.5 2 4.5 5"/>',
    chart: '<path d="M4 20h16"/><rect x="5" y="11" width="3" height="9" rx=".8"/><rect x="10.5" y="5" width="3" height="15" rx=".8"/><rect x="16" y="14" width="3" height="6" rx=".8"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M4 18l5-5 4 4 3-3 4 4"/>',
    person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    case: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M3 13h18"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/>',
    key: '<circle cx="8" cy="15" r="3.5"/><path d="M10.5 12.5L20 3M16 7l3 3M14 9l2 2"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    up: '<path d="M6 15l6-6 6 6"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    ext: '<path d="M7 17L17 7M8 7h9v9"/>',
    pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  };
  function ico(name, size) {
    var n = size || 20;
    return '<svg viewBox="0 0 24 24" width="' + n + '" height="' + n + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (ICONS[name] || "") + "</svg>";
  }
  function fmtN(n) { return Number(n || 0).toLocaleString("fr-FR"); }

  /* ───────── Coque (barre, onglets, routage) ───────── */
  // [adresse, libellé, icône, groupe]
  function tabsFor() {
    var t = [];
    if (can("stats.read")) t.push(["#/tableau", "Tableau de bord", "grid", ""]);
    if (can("article.create") || can("article.edit_own") || can("article.edit_any") || can("article.sponsor")) t.push(["#/articles", "Articles", "doc", "Contenu"]);
    if (can("media.upload")) t.push(["#/medias", "Médias", "image", "Contenu"]);
    if (can("author.manage")) t.push(["#/equipe", "Équipe", "person", "Contenu"]);
    if (can("partner.manage")) t.push(["#/partenaires", "Partenaires", "star", "Contenu"]);
    if (can("job.manage")) t.push(["#/offres", "Offres d'emploi", "case", "Contenu"]);
    if (can("taxonomy.manage")) t.push(["#/rubriques", "Rubriques", "grid", "Contenu"]);
    if (can("contact.read")) t.push(["#/messages", "Messages", "mail", "Lecteurs"]);
    if (can("comment.moderate")) t.push(["#/commentaires", "Commentaires", "mail", "Lecteurs"]);
    if (can("subscriber.read") || can("stats.read")) t.push(["#/abonnes", "Abonnés", "users", "Lecteurs"]);
    if (can("stats.read")) t.push(["#/stats", "Statistiques", "chart", "Lecteurs"]);
    if (can("settings.manage")) t.push(["#/pages", "Pages du site", "doc", "Administration"]);
    if (can("settings.manage")) t.push(["#/reglages", "Réglages", "gear", "Administration"]);
    if (can("user.manage")) t.push(["#/comptes", "Comptes", "users", "Administration"]);
    t.push(["#/compte", "Mon compte", "key", "Mon espace"]);
    return t;
  }

  function start() {
    clear(app);
    var tabs = h("div", { class: "hn-tabs-in", role: "navigation", "aria-label": "Sections" });
    var main = h("main", { class: "hn-main", id: "view" });
    var initial = (S.user.name || "?").trim().charAt(0).toUpperCase();
    var nav = h("aside", { class: "hn-nav" }, h("div", { class: "hn-nav-in" },
      h("a", { class: "hn-brand", href: "#/", "aria-label": "Espace rédaction HNet Media" }, h("img", { src: "/assets/logo.png", alt: "HNet Media" })),
      h("div", { class: "hn-tabs" }, tabs)));
    var body = h("div", { class: "hn-body" },
      h("div", { class: "hn-bar" }, h("div", { class: "hn-bar-in" },
        h("img", { class: "hn-bar-logo", src: "/assets/logo.png", alt: "HNet Media" }),
        h("span", { class: "hn-bar-title", text: "Espace rédaction" }),
        h("a", { class: "hn-site", href: "/", target: "_blank", rel: "noopener" }, h("span", { html: ico("globe", 16) }), h("span", { text: "Voir le site" })),
        h("span", { class: "hn-bar-user" },
          h("span", { class: "hn-avatar", "aria-hidden": "true", text: initial }),
          h("span", { class: "hn-who" }, h("strong", { text: S.user.name }), h("small", { text: ROLES[S.user.role] || S.user.role })),
          h("button", { type: "button", text: "Déconnexion", onclick: logout })))),
      main);
    app.appendChild(h("div", { class: "hn-shell" }, nav, body));
    var last = null;
    tabsFor().forEach(function (t) {
      if (t[3] !== last && t[3]) tabs.appendChild(h("span", { class: "hn-nav-lbl", text: t[3] }));
      last = t[3];
      tabs.appendChild(h("a", { href: t[0], "data-h": t[0] }, h("span", { class: "hn-ico", html: ico(t[2], 18) }), h("span", { text: t[1] })));
    });
    window.removeEventListener("hashchange", route);
    window.addEventListener("hashchange", route);
    if (!location.hash || location.hash === "#" || location.hash === "#/") location.hash = tabsFor()[0][0]; else route();
    setTimeout(handleShared, 500); // contenu partagé reçu avant la connexion
  }

  function logout() {
    if (guard && !guard()) return;
    (fcmToken ? api("DELETE", "devices", { token: fcmToken }, { quiet401: true }).catch(function () {}) : Promise.resolve())
      .then(function () { return api("POST", "auth/logout", {}); }).catch(function () { /* déjà déconnecté */ }).then(function () {
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
    if (parts[0] === "tableau" && can("stats.read")) run = function () { return renderDashboard(view); };
    else if (parts[0] === "articles" && parts[1]) run = function () { return renderArticle(view, parts[1]); };
    else if (parts[0] === "articles") run = function () { return renderArticles(view); };
    else if (parts[0] === "messages") run = function () { return renderMessages(view); };
    else if (parts[0] === "commentaires" && can("comment.moderate")) run = function () { return renderComments(view); };
    else if (parts[0] === "abonnes") run = function () { return renderSubscribers(view); };
    else if (parts[0] === "stats" && can("stats.read")) run = function () { return renderStats(view); };
    else if (parts[0] === "medias" && can("media.upload")) run = function () { return renderMedia(view); };
    else if (parts[0] === "equipe" && can("author.manage")) run = function () { return renderTeam(view); };
    else if (parts[0] === "partenaires" && can("partner.manage")) run = function () { return renderPartners(view); };
    else if (parts[0] === "offres" && can("job.manage")) run = function () { return renderJobs(view); };
    else if (parts[0] === "rubriques" && can("taxonomy.manage")) run = function () { return renderCategories(view); };
    else if (parts[0] === "pages" && parts[1] && parts[2] && can("settings.manage")) run = function () { return renderPageEdit(view, parts[1], parts[2]); };
    else if (parts[0] === "pages" && can("settings.manage")) run = function () { return renderPages(view); };
    else if (parts[0] === "reglages" && can("settings.manage")) run = function () { return renderSettings(view); };
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
                h("td", { "data-l": "Statut" }, badge(a.status, a.sponsored), a.reviewRequestedAt && a.status === "brouillon" ? h("span", { class: "badge badge-scheduled", style: "margin-left:6px", text: "À approuver" }) : null),
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
      if (S.openNew) { S.openNew = false; if (can("article.create")) setTimeout(createArticle, 0); }
      return load();
    });
  }

  /* ───────── Icônes de la page (balisage statique) ───────── */
  var PAGE_ICONS = {
    back: '<path d="M15 5l-7 7 7 7"/>',
    save: '<path d="M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    panel: '<rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M15 5v14"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    zoomIn: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.5-4.5M11 8v6M8 11h6"/>',
    zoomOut: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.5-4.5M8 11h6"/>'
  };
  function pageIcon(name, size) {
    var n = size || 18;
    return '<svg viewBox="0 0 24 24" width="' + n + '" height="' + n + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (PAGE_ICONS[name] || "") + "</svg>";
  }

  /* ───────── Contenu reçu d'une autre application (partage Android → « HNet Media ») ─────────
     L'application appelle window.onAppShare({ text, subject, files:[{ name, mime, data(base64) }] }).
     Un texte, un lien ou une photo deviennent un BROUILLON (jamais publié) après confirmation. Les vidéos ne sont
     pas prises en charge (le site n'accepte que des images). */
  var shared = null;
  function ackShare() { try { if (window.AppBridge) window.AppBridge.postMessage("shareack:"); } catch (e) { /* hors appli */ } }
  window.onAppShare = function (d) {
    if (d && (d.text || (d.files && d.files.length))) { shared = d; handleShared(); }
  };
  function escHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function b64ToFile(f) {
    var bin = atob(f.data), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new File([u], f.name || "photo", { type: f.mime });
  }
  function handleShared() {
    // Attend qu'une session soit ouverte et que l'écran soit prêt (connexion possible après la réception).
    if (!shared || !S.user || !S.csrf || !document.getElementById("view")) return;
    var d = shared; shared = null; ackShare();
    if (!can("article.create")) { toast("Votre rôle ne permet pas de créer un article.", true); return; }
    var text = String(d.text || "").trim();
    var url = (text.match(/https?:\/\/[^\s<>"]+/) || [])[0] || null;
    var body = url ? text.replace(url, "").trim() : text;
    var files = d.files || [];
    var img = files.filter(function (f) { return /^image\/(jpeg|png|webp)$/.test(f.mime); })[0];
    var skipped = files.length - (img ? 1 : 0);
    var firstLine = String(d.subject || body.split("\n")[0] || (url ? "Lien partagé" : "Photo partagée")).trim().slice(0, 200);
    var fields = [{ name: "title", label: "Titre du brouillon", value: firstLine, required: true, max: 300 }];
    if (img) fields.push({ name: "alt", label: "Description de la photo (obligatoire)", required: true, max: 200, hint: "Elle sert aux personnes qui ne voient pas l'image." });
    var what = [img ? "1 photo" : null, url ? "1 lien" : null, body ? "du texte" : null].filter(Boolean).join(", ");
    ask("Créer un brouillon ?", fields, {
      submit: "Créer le brouillon",
      intro: "Contenu reçu : " + what + ". Un brouillon sera créé (il ne sera pas publié)." + (skipped ? " " + skipped + " fichier(s) ignoré(s) : seules les photos JPEG, PNG ou WebP sont acceptées." : "")
    }).then(function (v) {
      if (!v) return;
      var upload = img ? prepareImage(b64ToFile(img)).then(function (r) { return uploadImage(r.blob); }) : Promise.resolve(null);
      return upload.then(function (media) {
        return api("POST", "articles", { title: v.title }).then(function (r) {
          var id = r.article.id;
          var paras = body ? body.split(/\n{1,}/).map(function (p) { return "<p>" + escHtml(p.trim()) + "</p>"; }).join("") : "";
          if (url) paras += '<p><a href="' + escHtml(url) + '" rel="nofollow noopener">' + escHtml(url) + "</a></p>";
          var patch = { translations: { fr: { title: v.title, content: paras } } };
          if (url && /^https:\/\//.test(url)) patch.sources = [{ name: "Lien partagé", url: url }];
          if (media) patch.mainImage = { url: media.url, alt: v.alt };
          return api("PUT", "articles/" + encodeURIComponent(id), patch).then(function () {
            toast("Brouillon créé à partir du contenu partagé.");
            location.hash = "#/articles/" + encodeURIComponent(id);
          });
        });
      }).catch(function (x) { toast((x && x.message) || "Impossible de créer le brouillon.", true); });
    });
  }
  if (window.__appShare) window.onAppShare(window.__appShare);

  /* ───────── Images : réduction sur l'appareil, envoi, sélecteur ───────── */
  var MAX_ORIGINAL = 30 * 1024 * 1024;

  function canvasBlob(canvas, type, quality) {
    return new Promise(function (resolve) { canvas.toBlob(resolve, type, quality); });
  }

  // Réduit la photo (1 600 px au plus) et la ré-encode : fichier léger, et métadonnées (position GPS…) supprimées.
  function prepareImage(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return Promise.reject(new Error("Format non pris en charge. Utilisez une photo JPEG, PNG ou WebP."));
    if (file.size > MAX_ORIGINAL) return Promise.reject(new Error("Fichier trop volumineux (30 Mo au maximum)."));
    var decode = window.createImageBitmap ? createImageBitmap(file, { imageOrientation: "from-image" }) : Promise.reject(new Error("x"));
    return decode.catch(function () { throw new Error("Impossible de lire cette image."); }).then(function (bmp) {
      function render(maxSide, type, quality, flatten) {
        var scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
        var w = Math.max(1, Math.round(bmp.width * scale)), hgt = Math.max(1, Math.round(bmp.height * scale));
        var c = document.createElement("canvas");
        c.width = w; c.height = hgt;
        var ctx = c.getContext("2d");
        if (flatten) { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, hgt); }
        ctx.drawImage(bmp, 0, 0, w, hgt);
        return canvasBlob(c, type, quality).then(function (blob) { return { blob: blob, width: w, height: hgt }; });
      }
      var tries = [[1600, 0.85], [1600, 0.72], [1280, 0.7], [1000, 0.65]];
      function attempt(i) {
        return render(tries[i][0], "image/webp", tries[i][1], false).then(function (r) {
          if (!r.blob || r.blob.type !== "image/webp") return render(tries[i][0], "image/jpeg", Math.min(0.88, tries[i][1] + 0.03), true);
          return r;
        }).then(function (r) {
          if (!r.blob) throw new Error("Impossible de préparer cette image.");
          if (r.blob.size > 1.9 * 1024 * 1024 && i < tries.length - 1) return attempt(i + 1);
          if (r.blob.size > 1.9 * 1024 * 1024) throw new Error("Cette image reste trop lourde après réduction. Choisissez-en une plus petite.");
          return r;
        });
      }
      return attempt(0).then(function (r) { if (bmp.close) bmp.close(); return r; }, function (e) { if (bmp.close) bmp.close(); throw e; });
    });
  }

  function uploadImage(blob) {
    return fetch("/api/admin/media", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/octet-stream", "X-CSRF-Token": S.csrf || "" },
      body: blob
    }).catch(function () { throw ApiError(0, "Connexion impossible. Vérifiez votre réseau et réessayez."); })
      .then(function (res) {
        return res.json().catch(function () { return null; }).then(function (data) {
          if (!res.ok) {
            if (res.status === 401) sessionLost();
            throw ApiError(res.status, (data && data.error) || "Échec de l'envoi (" + res.status + ").", data);
          }
          return data.media;
        });
      });
  }

  /**
   * Fenêtre « Insérer une image » : depuis l'appareil (photo réduite automatiquement), depuis la médiathèque,
   * ou par adresse web. Texte alternatif obligatoire. Retourne { src, alt, caption, credit } ou null.
   * current : image actuelle { src, alt, caption, credit } ou null ; options.credit : demander un crédit photo.
   */
  function pickImage(current, options) {
    options = options || {};
    return openDialog(function (box, close) {
      var chosen = current && current.src ? { kind: "keep", src: current.src } : null;
      var prepared = null; // { blob, width, height } pour une photo de l'appareil
      var busy = false;
      var err = h("div", { class: "hn-alert", hidden: true, role: "alert" });
      var alt = h("input", { id: "img-alt", type: "text", maxlength: 300, value: current ? current.alt : "", autocomplete: "off" });
      var cap = h("input", { id: "img-cap", type: "text", maxlength: 300, value: current ? current.caption : "", autocomplete: "off" });
      var cred = options.credit ? h("input", { id: "img-cred", type: "text", maxlength: 150, value: current ? current.credit : "", autocomplete: "off" }) : null;
      var fileIn = h("input", { id: "img-file", type: "file", accept: "image/jpeg,image/png,image/webp" });
      var urlIn = h("input", { id: "img-url", type: "url", placeholder: "https://…", autocomplete: "off", value: current && /^https:/.test(current.src || "") ? current.src : "" });
      var prevImg = h("img", { alt: "Aperçu de l'image choisie", class: "pk-prev-img" });
      var prevInfo = h("p", { class: "hn-hint", style: "margin:6px 0 0" });
      var prev = h("div", { class: "pk-prev", hidden: true }, prevImg, prevInfo);
      var grid = h("div", { class: "pk-grid", "aria-label": "Images déjà téléversées" });
      var okBtn = h("button", { type: "submit", class: "hn-btn hn-btn-primary", text: current ? "Enregistrer" : "Insérer" });
      var cancelBtn = h("button", { type: "button", class: "hn-btn hn-btn-ghost", text: "Annuler", onclick: function () { if (!busy) close(null); } });

      function showPreview(src, info) { prevImg.src = src; prevInfo.textContent = info || ""; prev.hidden = !src; }
      if (current && current.src) showPreview(current.src, "Image actuelle — inchangée si vous n'en choisissez pas une autre.");

      var panes = {
        file: h("div", { class: "pk-pane", "data-p": "file" },
          h("label", { class: "pk-file", for: "img-file" }, h("span", { html: pageIcon("upload", 22) }), h("span", { text: "Choisir une photo sur cet appareil" }), fileIn),
          h("p", { class: "hn-hint", text: "La photo est réduite automatiquement (1 600 px au plus) et ses informations cachées, comme la position GPS, sont supprimées." })),
        lib: h("div", { class: "pk-pane", "data-p": "lib", hidden: true }, grid),
        url: h("div", { class: "pk-pane", "data-p": "url", hidden: true },
          h("label", { for: "img-url", text: "Adresse de l'image (https://…)" }), urlIn,
          h("p", { class: "hn-hint", text: "Image déjà en ligne ailleurs. Vérifiez que vous avez le droit de l'utiliser." }))
      };
      var segBtns = {};
      var seg = h("div", { class: "wd-seg", role: "tablist", "aria-label": "Source de l'image" });
      [["file", "Mon appareil"], ["lib", "Médiathèque"], ["url", "Adresse web"]].forEach(function (t) {
        var b = h("button", { type: "button", role: "tab", "data-t": t[0], text: t[1], onclick: function () { setTab(t[0]); } });
        segBtns[t[0]] = b; seg.appendChild(b);
      });
      var libLoaded = false;
      function setTab(t) {
        Object.keys(panes).forEach(function (k) { panes[k].hidden = k !== t; segBtns[k].classList.toggle("on", k === t); segBtns[k].setAttribute("aria-selected", String(k === t)); });
        if (t === "lib" && !libLoaded) {
          libLoaded = true;
          grid.appendChild(h("p", { class: "hn-muted", text: "Chargement…" }));
          api("GET", "media").then(function (r) {
            clear(grid);
            if (!r.items.length) { grid.appendChild(h("p", { class: "hn-muted", text: "Aucune image téléversée pour l'instant." })); return; }
            r.items.forEach(function (m) {
              var b = h("button", { type: "button", class: "pk-thumb", title: m.width + " × " + m.height + " px", "aria-label": "Image " + m.width + " sur " + m.height + " pixels" }, h("img", { src: m.url, alt: "", loading: "lazy" }));
              b.addEventListener("click", function () {
                Array.prototype.forEach.call(grid.children, function (x) { x.classList.remove("on"); });
                b.classList.add("on"); chosen = { kind: "lib", src: m.url }; prepared = null;
                showPreview(m.url, m.width + " × " + m.height + " px"); err.hidden = true;
              });
              grid.appendChild(b);
            });
          }).catch(function (x) { clear(grid); grid.appendChild(h("p", { class: "hn-muted", text: x.message })); });
        }
      }
      fileIn.addEventListener("change", function () {
        var f = fileIn.files && fileIn.files[0];
        err.hidden = true;
        if (!f) return;
        showPreview("", ""); prev.hidden = false; prevInfo.textContent = "Préparation de la photo…";
        okBtn.disabled = true;
        prepareImage(f).then(function (r) {
          prepared = r; chosen = { kind: "file" };
          if (prevImg.dataset.url) URL.revokeObjectURL(prevImg.dataset.url);
          var u = URL.createObjectURL(r.blob); prevImg.dataset.url = u; prevImg.src = u;
          prevInfo.textContent = r.width + " × " + r.height + " px · " + Math.max(1, Math.round(r.blob.size / 1024)) + " Ko après réduction";
        }).catch(function (e) {
          prepared = null; chosen = current && current.src ? { kind: "keep", src: current.src } : null; fileIn.value = "";
          prev.hidden = !(current && current.src); if (current && current.src) showPreview(current.src, "Image actuelle.");
          err.textContent = e.message; err.hidden = false;
        }).then(function () { okBtn.disabled = false; });
      });

      var form = h("form", { class: "hn-form", novalidate: true },
        h("h2", { text: options.title || (current ? "Modifier l'image" : "Insérer une image") }),
        seg, panes.file, panes.lib, panes.url, prev,
        h("label", { for: "img-alt", text: "Texte alternatif (obligatoire : décrit l'image aux lecteurs d'écran)" }), alt,
        h("label", { for: "img-cap", text: options.credit ? "Légende" : "Légende et crédit (ex. « Le port de Jacmel. Photo : Nom Prénom »)" }), cap,
        cred ? h("label", { for: "img-cred", text: "Crédit photo" }) : null, cred,
        err,
        h("div", { class: "hn-actions" }, cancelBtn, okBtn));
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        if (busy) return;
        err.hidden = true;
        function fail(m) { err.textContent = m; err.hidden = false; }
        if (!String(alt.value).trim()) { fail("Le texte alternatif est obligatoire."); alt.focus(); return; }
        // Source selon l'onglet actif
        var activeTab = Object.keys(panes).filter(function (k) { return !panes[k].hidden; })[0];
        var src = null, pending = null;
        if (activeTab === "url" && urlIn.value.trim()) {
          try { var u = new URL(urlIn.value.trim()); if (u.protocol !== "https:") throw new Error(); src = u.toString(); }
          catch (x) { fail("L'adresse de l'image doit commencer par https://"); urlIn.focus(); return; }
        } else if (chosen && chosen.kind === "file" && prepared) pending = prepared;
        else if (chosen && (chosen.kind === "lib" || chosen.kind === "keep")) src = chosen.src;
        else if (urlIn.value.trim()) {
          try { var u2 = new URL(urlIn.value.trim()); if (u2.protocol !== "https:") throw new Error(); src = u2.toString(); }
          catch (x2) { fail("L'adresse de l'image doit commencer par https://"); return; }
        }
        if (!src && !pending) { fail("Choisissez une image : une photo de l'appareil, une image de la médiathèque ou une adresse web."); return; }
        function done(finalSrc) {
          close({ src: finalSrc, alt: String(alt.value).trim(), caption: String(cap.value).trim(), credit: cred ? String(cred.value).trim() : "" });
        }
        if (src) return done(src);
        busy = true; okBtn.disabled = true; okBtn.textContent = "Envoi en cours…"; cancelBtn.disabled = true;
        uploadImage(pending.blob).then(function (m) { done(m.url); }).catch(function (x) {
          busy = false; okBtn.disabled = false; okBtn.textContent = current ? "Enregistrer" : "Insérer"; cancelBtn.disabled = false; fail(x.message);
        });
      });
      box.appendChild(form);
      setTab(current && current.src && /^https:/.test(current.src) ? "url" : "file");
    }, true);
  }

  /* ───────── Articles : éditeur (présentation façon traitement de texte) ───────── */
  function renderArticle(view, id) {
    return Promise.all([ensureMeta(), api("GET", "articles/" + encodeURIComponent(id)), loadEditor()]).then(function (res) {
      var meta = res[0];
      var a = res[1].article;
      var rights = a.rights;
      var editable = rights.edit;
      var origLang = a.originalLang || "fr";
      var cur = origLang;
      var dirty = false, imgDirty = false, saving = false;
      var savedAt = a.updatedAt ? new Date(a.updatedAt) : null;
      var tr = {};
      LANGS.forEach(function (l) {
        var t = a.translations[l[0]] || {};
        tr[l[0]] = { title: t.title || "", kicker: t.kicker || "", excerpt: t.excerpt || "", content: t.content || "", seoTitle: t.seo_title || "", seoDescription: t.seo_description || "", reviewed: !!t.reviewed };
      });
      var sources = (a.sources || []).map(function (s) { return { name: s.name, url: s.url || "", description: s.description || "" }; });
      var mainImg = a.mainImage ? { url: a.mainImage.url, alt: a.mainImage.alt || "", caption: a.mainImage.caption || "", credit: a.mainImage.credit || "" } : { url: "", alt: "", caption: "", credit: "" };
      var draftKey = "hnet-brouillon-" + a.id;
      var ed = null, langReady = false, zoom = 100;
      var paneOn = window.matchMedia("(min-width: 901px)").matches;

      function markDirty() { if (!editable) return; dirty = true; refreshChrome(); }
      function autosize(t) { t.style.height = "auto"; t.style.height = (t.scrollHeight + 2) + "px"; }
      var inp = function (props) { return h("input", Object.assign({ type: "text", disabled: !editable, oninput: markDirty }, props)); };
      var f = {
        kicker: h("input", { id: "a-kicker", type: "text", class: "wd-kicker", maxlength: 120, placeholder: "SURTITRE (facultatif)", "aria-label": "Surtitre", disabled: !editable, oninput: markDirty }),
        title: h("textarea", { id: "a-title", class: "wd-titlein", rows: 1, maxlength: 300, placeholder: "Titre de l'article", "aria-label": "Titre", disabled: !editable, oninput: function () { autosize(f.title); refreshChrome(); markDirty(); } }),
        excerpt: h("textarea", { id: "a-excerpt", class: "wd-excerpt", rows: 2, maxlength: 600, placeholder: "Chapeau : résumé en deux ou trois phrases…", "aria-label": "Chapeau", disabled: !editable, oninput: function () { autosize(f.excerpt); markDirty(); } }),
        reviewed: h("input", { type: "checkbox", id: "a-rev", disabled: !can("translation.edit"), onchange: markDirty }),
        seoTitle: inp({ id: "a-seot", maxlength: 120 }),
        seoDesc: h("textarea", { id: "a-seod", maxlength: 300, rows: 2, disabled: !editable, oninput: markDirty }),
        slug: inp({ id: "a-slug", maxlength: 120 }),
        category: h("select", { id: "a-cat", disabled: !editable, onchange: markDirty }, h("option", { value: "", text: "— Choisir —" }), meta.categories.map(function (c) { return h("option", { value: c.slug, text: c.label }); })),
        type: h("select", { id: "a-type", disabled: !editable, onchange: markDirty }, TYPES.map(function (t) { return h("option", { value: t[0], text: t[1] }); })),
        author: h("select", { id: "a-author", disabled: !editable, onchange: markDirty }, h("option", { value: "", text: "— Aucune fiche auteur —" }), meta.authors.map(function (x) { return h("option", { value: x.id, text: x.name }); })),
        signature: inp({ id: "a-sign", maxlength: 150 }),
        tags: inp({ id: "a-tags", placeholder: "élections, CEP, Port-au-Prince" }),
        imgAlt: inp({ id: "a-ialt", maxlength: 300, oninput: function () { mainImg.alt = f.imgAlt.value; imgDirty = true; markDirty(); } }),
        imgCap: inp({ id: "a-icap", maxlength: 300, oninput: function () { mainImg.caption = f.imgCap.value; imgDirty = true; markDirty(); } }),
        imgCred: inp({ id: "a-icred", maxlength: 150, oninput: function () { mainImg.credit = f.imgCred.value; imgDirty = true; markDirty(); } }),
        featured: h("input", { type: "checkbox", id: "a-feat", disabled: !rights.publish, onchange: markDirty }),
        urgent: h("input", { type: "checkbox", id: "a-urg", disabled: !rights.publish, onchange: markDirty }),
        recommended: h("input", { type: "checkbox", id: "a-rec", disabled: !rights.publish, onchange: markDirty })
      };
      f.slug.value = a.slug; f.category.value = a.category || ""; f.type.value = a.type;
      f.author.value = a.authorId || ""; f.signature.value = a.authorName || "";
      f.tags.value = (a.tags || []).map(function (t) { return t.label; }).join(", ");
      f.imgAlt.value = mainImg.alt; f.imgCap.value = mainImg.caption; f.imgCred.value = mainImg.credit;
      f.featured.checked = a.featured; f.urgent.checked = a.urgent; f.recommended.checked = a.recommended;

      var label = function (text, forId) { return h("label", { for: forId, text: text }); };
      var fmtTime = function (d) { return d ? d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : ""; };

      /* ── éléments de la page ── */
      var wd = h("div", { class: "wd" + (paneOn ? " wd-pane-on" : "") });
      var docName = h("span", { class: "wd-docname", id: "wd-docname" });
      var statusBadge = h("span", { class: "wd-status-badge" });
      var langSeg = h("div", { class: "wd-langs", role: "group", "aria-label": "Langue du texte" });
      var saveBtn = h("button", { type: "button", class: "wd-tbtn wd-save", "aria-label": "Enregistrer (Ctrl+S)", title: "Enregistrer (Ctrl+S)", onclick: function () { save(false); } },
        h("span", { html: pageIcon("save") }), h("span", { class: "wd-tlbl", text: "Enregistrer" }));
      var previewBtn = h("button", { type: "button", class: "wd-tbtn wd-preview", "aria-label": "Aperçu de l'article", title: "Aperçu", onclick: preview },
        h("span", { html: pageIcon("eye") }), h("span", { class: "wd-tlbl", text: "Aperçu" }));
      var publishBtn = h("button", { type: "button", class: "wd-tbtn wd-publish primary", "aria-haspopup": "menu", "aria-expanded": "false" });
      var publishMenu = h("div", { class: "wd-menu", role: "menu", hidden: true });
      var publishWrap = h("div", { class: "wd-pubwrap" }, publishBtn, publishMenu);
      var paneBtn = h("button", { type: "button", class: "wd-tbtn wd-panebtn", "aria-label": "Volet Propriétés", title: "Propriétés de l'article", onclick: togglePane },
        h("span", { html: pageIcon("panel") }), h("span", { class: "wd-tlbl", text: "Propriétés" }));
      var titleBar = h("header", { class: "wd-title" },
        h("a", { class: "wd-back", href: "#/articles", "aria-label": "Retour à la liste des articles", title: "Retour aux articles", html: pageIcon("back", 20) }),
        h("div", { class: "wd-doc" }, docName, statusBadge),
        langSeg,
        h("div", { class: "wd-actions" }, saveBtn, previewBtn, publishWrap, paneBtn));

      var ribbonEl = h("div", { class: "wd-ribbon" });
      var statsEl = h("span", { class: "wd-stats", "aria-live": "polite" });
      var saveState = h("span", { class: "wd-savestate", "aria-live": "polite" });
      var zoomLbl = h("span", { class: "wd-zoomval", text: "100 %" });
      var zoomOutB = h("button", { type: "button", class: "wd-zbtn", "aria-label": "Zoom arrière", html: pageIcon("zoomOut", 16), onclick: function () { setZoom(zoom - 10); } });
      var zoomInB = h("button", { type: "button", class: "wd-zbtn", "aria-label": "Zoom avant", html: pageIcon("zoomIn", 16), onclick: function () { setZoom(zoom + 10); } });
      var statusBar = h("footer", { class: "wd-statusbar" }, statsEl, saveState, h("span", { class: "wd-zoom" }, zoomOutB, zoomLbl, zoomInB));

      /* feuille (page) */
      var langHint = h("p", { class: "wd-langhint" });
      var revWrap = h("div", { class: "hn-checks wd-rev" }, h("label", { for: "a-rev" }, f.reviewed, "Traduction relue et validée par un humain"));
      var contentEl = h("div", { class: "hn-ed-content article-body", id: "a-editor" });
      var sheet = h("article", { class: "wd-sheet" }, h("div", { class: "wd-langbanner" }, langHint, revWrap), f.kicker, f.title, f.excerpt, h("hr", { class: "wd-rule" }), contentEl);
      var canvas = h("div", { class: "wd-canvas" }, sheet);

      /* volet Propriétés */
      var statusBox = h("div");
      var corrBox = h("div");
      var srcBox = h("div", { class: "hn-rows" });
      var imgBox = h("div");
      function section(title, open, id, body) {
        return h("details", { class: "wd-sec", "data-sec": id, open: open }, h("summary", { text: title }), h("div", { class: "wd-sec-body hn-form" }, body));
      }
      var sponsorBox = null;
      if (rights.sponsor) {
        var sp = h("input", { type: "checkbox", id: "a-sp", checked: a.sponsored, onchange: function () {
          api("POST", "articles/" + encodeURIComponent(a.id) + "/sponsored", { sponsored: sp.checked }).then(function (r) { a = r.article; refreshChrome(); toast(a.sponsored ? "Mention « Sponsorisé » activée." : "Mention « Sponsorisé » retirée."); })
            .catch(function (x) { sp.checked = !sp.checked; toast(x.message, true); });
        } });
        sponsorBox = h("div", { class: "hn-checks" }, h("label", { for: "a-sp" }, sp, "Contenu sponsorisé (affiche la mention)"));
      }
      var rebuildNote = h("div", { class: meta.siteRebuild ? "update-note" : "correction-note", style: "margin-top:12px", text: meta.siteRebuild
        ? "Publier, dépublier, archiver ou corriger met le site à jour automatiquement (1 à 2 minutes)."
        : "La mise à jour automatique du site n'est pas encore configurée : après une publication, le site ne changera qu'au prochain déploiement." });
      var paneClose = h("button", { type: "button", class: "wd-paneclose", "aria-label": "Fermer le volet Propriétés", html: pageIcon("close", 20), onclick: togglePane });
      var pane = h("aside", { class: "wd-pane", "aria-label": "Propriétés de l'article" },
        h("div", { class: "wd-panehead" }, h("strong", { text: "Propriétés de l'article" }), paneClose),
        section("Publication", true, "pub", [statusBox, sponsorBox, rebuildNote]),
        section("Classement", true, "cls", [
          label("Rubrique", "a-cat"), f.category, label("Type de contenu", "a-type"), f.type,
          label("Auteur", "a-author"), f.author, label("Ou signature libre", "a-sign"), f.signature,
          label("Adresse (slug)", "a-slug"), f.slug, label("Mots-clés (séparés par des virgules)", "a-tags"), f.tags,
          rights.publish ? h("div", { class: "hn-checks" }, h("label", { for: "a-feat" }, f.featured, "À la une"), h("label", { for: "a-urg" }, f.urgent, "Urgent"), h("label", { for: "a-rec" }, f.recommended, "Recommandé")) : null]),
        section("Image principale", false, "img", imgBox),
        section("Sources", false, "src", [h("p", { class: "hn-hint", style: "margin:0 0 10px", text: "Indiquez vos sources : elles apparaissent sous l'article." }), srcBox]),
        section("Référencement", false, "seo", [label("Titre pour les moteurs de recherche (60 caractères conseillés)", "a-seot"), f.seoTitle, label("Description pour les moteurs de recherche (150 caractères conseillés)", "a-seod"), f.seoDesc]),
        section("Corrections publiques", false, "cor", corrBox),
        rights.delete ? section("Zone dangereuse", false, "del", h("button", { type: "button", class: "hn-btn hn-btn-danger", text: "Supprimer définitivement", onclick: deleteArticle })) : null);

      /* ── ruban : onglet « Affichage » propre à la page ── */
      var viewTab = { id: "affichage", label: "Affichage", groups: [
        { label: "Zoom", items: [
          { id: "zoom-out", icon: "zoomOut", big: true, label: "Réduire", title: "Zoom arrière", run: function () { setZoom(zoom - 10); } },
          { id: "zoom-in", icon: "zoomIn", big: true, label: "Agrandir", title: "Zoom avant", run: function () { setZoom(zoom + 10); } },
          { id: "zoom-100", icon: "zoomIn", big: true, label: "100 %", title: "Zoom 100 %", run: function () { setZoom(100); } }
        ] },
        { label: "Afficher", items: [
          { id: "view-pane", icon: "panel", big: true, label: "Propriétés", title: "Volet Propriétés", run: togglePane, isActive: function () { return paneOn; } },
          { id: "view-preview", icon: "eye", big: true, label: "Aperçu", title: "Aperçu de l'article", run: preview }
        ] }
      ] };

      /* ── fonctions ── */
      function setZoom(z) {
        zoom = Math.max(70, Math.min(160, Math.round(z / 10) * 10));
        sheet.style.zoom = String(zoom / 100);
        zoomLbl.textContent = zoom + " %";
        autosize(f.title); autosize(f.excerpt);
      }
      function togglePane() {
        paneOn = !paneOn;
        wd.classList.toggle("wd-pane-on", paneOn);
        paneBtn.classList.toggle("is-active", paneOn);
        if (ed) ed.refresh();
      }
      function saveCur() {
        var t = tr[cur];
        t.title = f.title.value; t.kicker = f.kicker.value; t.excerpt = f.excerpt.value;
        t.seoTitle = f.seoTitle.value; t.seoDescription = f.seoDesc.value; t.reviewed = f.reviewed.checked;
        t.content = ed ? ed.getHTML() : t.content;
      }
      function showLang(l) {
        if (langReady) saveCur(); // jamais à l'ouverture : le formulaire est encore vide
        langReady = true;
        cur = l;
        var t = tr[l];
        f.title.value = t.title; f.kicker.value = t.kicker; f.excerpt.value = t.excerpt;
        f.seoTitle.value = t.seoTitle; f.seoDesc.value = t.seoDescription; f.reviewed.checked = t.reviewed;
        if (ed) ed.setHTML(t.content);
        var orig = l === origLang;
        langHint.textContent = orig ? "" : (t.title ? "Version anglaise : elle est publiée sur la version anglaise du site (/en) une fois relue et validée par un humain. Aucune traduction automatique." : "Pas encore de version anglaise : saisissez un titre, un chapeau et un texte pour la créer. Elle ne sera publiée sur /en qu'une fois relue et validée.");
        sheet.classList.toggle("wd-translating", !orig);
        Array.prototype.forEach.call(langSeg.children, function (b) { var on = b.getAttribute("data-l") === l; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
        autosize(f.title); autosize(f.excerpt); refreshChrome();
      }
      LANGS.forEach(function (l) {
        langSeg.appendChild(h("button", { type: "button", "data-l": l[0], text: l[0].toUpperCase(), title: l[1], "aria-label": l[1], "aria-pressed": "false", onclick: function () { showLang(l[0]); } }));
      });

      function refreshChrome() {
        var name = (f.title.value || "").trim();
        docName.textContent = name || "Article sans titre";
        clear(statusBadge); statusBadge.appendChild(badge(a.status, a.sponsored));
        saveBtn.disabled = !editable || !dirty || saving;
        saveState.textContent = saving ? "Enregistrement…" : (!editable ? "Lecture seule" : dirty ? "● Modifications non enregistrées" : (savedAt ? "Enregistré à " + fmtTime(savedAt) : "À jour"));
        saveState.className = "wd-savestate" + (dirty ? " dirty" : "");
        publishBtn.innerHTML = "";
        publishBtn.appendChild(h("span", { class: "wd-tlbl2", text: a.status === "publie" ? "Publié" : a.status === "programme" ? "Programmé" : rights.publish ? "Publier" : "Soumettre" }));
        publishBtn.appendChild(h("span", { html: pageIcon("chevron", 16) }));
        Array.prototype.forEach.call(langSeg.children, function (b) {
          var l = b.getAttribute("data-l"); var has = l === cur ? !!f.title.value.trim() : !!(tr[l] && tr[l].title.trim());
          b.classList.toggle("has", has);
        });
        // statut + date dans la section Publication
        clear(statusBox);
        statusBox.appendChild(h("div", { style: "margin-bottom:8px" }, badge(a.status, a.sponsored)));
        statusBox.appendChild(h("p", { class: "hn-muted", text: a.publishedAt ? (a.status === "programme" ? "Publication prévue le " : "Publié le ") + fmt(a.publishedAt) : "Pas encore de date de publication." }));
        statusBox.appendChild(h("p", { class: "hn-muted", text: "Dernière modification : " + fmt(a.updatedAt) }));
        renderPublishMenu();
      }

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
          translations: translations
        };
        if (rights.publish) { body.featured = f.featured.checked; body.urgent = f.urgent.checked; body.recommended = f.recommended.checked; }
        if (imgDirty) body.mainImage = mainImg.url ? { url: mainImg.url, alt: mainImg.alt.trim(), caption: mainImg.caption.trim(), credit: mainImg.credit.trim() } : null;
        return body;
      }

      function save(quiet) {
        if (!editable || saving) return Promise.resolve(false);
        saving = true; refreshChrome();
        return api("PUT", "articles/" + encodeURIComponent(a.id), collect()).then(function (r) {
          a = r.article; rights = a.rights; dirty = false; imgDirty = false; saving = false; savedAt = new Date();
          try { localStorage.removeItem(draftKey); } catch (e) { /* ignoré */ }
          f.slug.value = a.slug; refreshChrome();
          if (!quiet) toast("Article enregistré.");
          return true;
        }).catch(function (x) { saving = false; refreshChrome(); toast(x.message, true); return false; });
      }

      function changeStatus(status, extra, okMsg) {
        return (dirty ? save(true) : Promise.resolve(true)).then(function (ok) {
          if (!ok) return;
          return api("POST", "articles/" + encodeURIComponent(a.id) + "/status", Object.assign({ status: status }, extra || {})).then(function (r) {
            a = r.article; rights = a.rights; refreshChrome(); renderCorrections();
            var msg = okMsg;
            if (status === "publie" || status === "programme") msg += r.article.rebuildTriggered ? " Mise à jour du site demandée." : " (Mise à jour automatique du site non configurée.)";
            toast(msg);
          }).catch(function (x) { toast(x.message, true); });
        });
      }

      /* menu « Publier » */
      function closeMenu() { publishMenu.hidden = true; publishBtn.setAttribute("aria-expanded", "false"); }
      function renderPublishMenu() {
        clear(publishMenu);
        var entries = [];
        if (rights.publish && a.status !== "publie") {
          entries.push(["Publier maintenant", function () {
            confirmBox("Cet article sera publié immédiatement, sous la signature indiquée.", { title: "Publier l'article ?", confirm: "Publier" }).then(function (ok) { if (ok) changeStatus("publie", null, "Article publié."); });
          }]);
          entries.push(["Programmer…", function () {
            var soon = new Date(Date.now() + 3600000); soon.setMinutes(0, 0, 0);
            var local = new Date(soon.getTime() - soon.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
            // Texte selon la dernière vérification automatique réellement observée (jamais de promesse en l'air)
            api("GET", "meta").catch(function () { return meta; }).then(function (m) {
              var last = m && m.scheduledLastRun ? new Date(m.scheduledLastRun) : null;
              var ageMin = last ? (Date.now() - last.getTime()) / 60000 : Infinity;
              var intro = ageMin < 30
                ? "Vérification automatique active (dernière il y a " + Math.max(1, Math.round(ageMin)) + " min) : l'article sera publié à quelques minutes de l'heure choisie."
                : ageMin < 36 * 60
                  ? "Le site vérifie les articles programmés environ une fois par jour (dernière vérification : " + fmt(last.toISOString()) + ") : l'article sera publié au plus tard dans les 24 heures qui suivent l'heure choisie."
                  : "Aucune vérification automatique récente : l'article ne sera publié qu'au prochain déploiement du site après l'heure choisie.";
              return ask("Programmer la publication", [{ name: "when", label: "Date et heure de publication", type: "datetime-local", value: local, required: true }], { submit: "Programmer", intro: intro });
            }).then(function (v) {
              if (v) changeStatus("programme", { publishedAt: new Date(v.when).toISOString() }, "Publication programmée.");
            });
          }]);
        }
        if (!rights.publish && editable && a.status === "brouillon") entries.push([a.reviewRequestedAt ? "Approbation demandée ✔" : "Demander l'approbation", function () {
          if (a.reviewRequestedAt) { toast("Déjà soumis le " + fmt(a.reviewRequestedAt) + " : un responsable va l'examiner."); return; }
          if (dirty) { toast("Enregistrez d'abord vos modifications.", true); return; }
          api("POST", "articles/" + encodeURIComponent(a.id) + "/review", {}).then(function (r) {
            a.reviewRequestedAt = r.article.reviewRequestedAt; renderPublishMenu(); toast("Article soumis : les approbateurs sont prévenus.");
          }).catch(function (x) { toast(x.message, true); });
        }]);
        if (rights.publish && a.status === "brouillon" && a.reviewRequestedAt) entries.push(["Renvoyer pour modifications…", function () {
          ask("Renvoyer l'article à son auteur", [{ name: "note", label: "Message à l'auteur (facultatif)", type: "text", required: false }], { submit: "Renvoyer" }).then(function (v) {
            if (!v) return;
            api("POST", "articles/" + encodeURIComponent(a.id) + "/review-return", { note: v.note || "" }).then(function (r) {
              a.reviewRequestedAt = r.article.reviewRequestedAt; renderPublishMenu(); toast("Article renvoyé à son auteur.");
            }).catch(function (x) { toast(x.message, true); });
          });
        }]);
        if (rights.publish && a.status === "publie") entries.push(["Dépublier (brouillon)", function () {
          confirmBox("L'article ne sera plus visible sur le site après la prochaine mise à jour.", { title: "Dépublier ?", confirm: "Dépublier" }).then(function (ok) { if (ok) changeStatus("brouillon", null, "Article repassé en brouillon."); });
        }]);
        if (rights.publish && a.status === "programme") entries.push(["Annuler la programmation", function () { changeStatus("brouillon", null, "Programmation annulée."); }]);
        if (rights.archive && a.status !== "archive") entries.push(["Archiver", function () {
          confirmBox("L'article sera retiré du site mais conservé.", { title: "Archiver ?", confirm: "Archiver" }).then(function (ok) { if (ok) changeStatus("archive", null, "Article archivé."); });
        }]);
        publishWrap.hidden = !entries.length;
        entries.forEach(function (en) {
          publishMenu.appendChild(h("button", { type: "button", role: "menuitem", class: "wd-menuitem", text: en[0], onclick: function () { closeMenu(); en[1](); } }));
        });
      }
      publishBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        var open = publishMenu.hidden;
        publishMenu.hidden = !open; publishBtn.setAttribute("aria-expanded", String(open));
      });
      function onDocClick(e) { if (!publishWrap.contains(e.target)) closeMenu(); }

      function preview() {
        saveCur();
        var t = tr[cur];
        openDialog(function (box, close) {
          var body = h("div", { class: "article-body" });
          body.innerHTML = ed.getHTML(); // HTML déjà normalisé par le schéma de l'éditeur
          box.appendChild(h("p", { class: "hn-muted", text: "Aperçu — présentation indicative (" + cur.toUpperCase() + ")" }));
          if (t.kicker) box.appendChild(h("p", { class: "hn-muted", style: "text-transform:uppercase;letter-spacing:1px;margin-top:10px", text: t.kicker }));
          box.appendChild(h("h1", { style: "font-family:'Playfair Display',serif;font-size:26px;line-height:1.2;color:var(--navy);margin:6px 0 10px", text: t.title || "(sans titre)" }));
          if (t.excerpt) box.appendChild(h("p", { style: "font-size:15px;color:var(--gray-dk);line-height:1.2;margin-bottom:16px", text: t.excerpt }));
          box.appendChild(body);
          box.appendChild(h("div", { class: "hn-actions" }, h("button", { type: "button", class: "hn-btn hn-btn-navy", text: "Fermer", onclick: function () { close(null); } })));
        }, true);
      }

      /* image principale */
      function renderMainImage() {
        clear(imgBox);
        if (mainImg.url) {
          imgBox.appendChild(h("img", { class: "wd-mainimg", src: mainImg.url, alt: mainImg.alt || "Image principale" }));
          imgBox.appendChild(label("Texte alternatif (obligatoire)", "a-ialt")); imgBox.appendChild(f.imgAlt);
          imgBox.appendChild(label("Légende", "a-icap")); imgBox.appendChild(f.imgCap);
          imgBox.appendChild(label("Crédit photo", "a-icred")); imgBox.appendChild(f.imgCred);
        } else imgBox.appendChild(h("p", { class: "hn-muted", text: "Aucune image principale." }));
        if (editable) {
          imgBox.appendChild(h("div", { class: "hn-actions", style: "margin-top:12px" },
            h("button", { type: "button", class: "hn-btn hn-btn-ghost hn-btn-sm wd-pickmain", text: mainImg.url ? "Changer l'image…" : "Choisir une image…", onclick: function () {
              pickImage(mainImg.url ? { src: mainImg.url, alt: mainImg.alt, caption: mainImg.caption, credit: mainImg.credit } : null, { credit: true, title: "Image principale" }).then(function (v) {
                if (!v) return;
                mainImg = { url: v.src, alt: v.alt, caption: v.caption, credit: v.credit };
                f.imgAlt.value = mainImg.alt; f.imgCap.value = mainImg.caption; f.imgCred.value = mainImg.credit;
                imgDirty = true; markDirty(); renderMainImage();
                var sec = pane.querySelector('[data-sec="img"]'); if (sec) sec.open = true;
              });
            } }),
            mainImg.url ? h("button", { type: "button", class: "hn-btn hn-btn-ghost hn-btn-sm", text: "Retirer", onclick: function () { mainImg = { url: "", alt: "", caption: "", credit: "" }; f.imgAlt.value = ""; f.imgCap.value = ""; f.imgCred.value = ""; imgDirty = true; markDirty(); renderMainImage(); } }) : null));
        }
      }

      /* sources */
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

      /* corrections */
      function renderCorrections() {
        clear(corrBox);
        if (a.corrections.length) a.corrections.forEach(function (c) { corrBox.appendChild(h("div", { class: "correction-note" }, h("strong", { text: fmt(c.corrected_at) + " — " }), c.text)); });
        else corrBox.appendChild(h("p", { class: "hn-muted", text: "Aucune correction publiée." }));
        if (rights.correct && a.status === "publie") {
          var ta = h("textarea", { rows: 3, maxlength: 1000, "aria-label": "Texte de la correction", placeholder: "Ex. : La date du scrutin a été corrigée (30 au lieu de 13)." });
          corrBox.appendChild(ta);
          corrBox.appendChild(h("div", { class: "hn-actions", style: "margin-top:10px" }, h("button", { type: "button", class: "hn-btn hn-btn-navy", text: "Publier la correction", onclick: function () {
            if (!ta.value.trim()) return toast("Saisissez le texte de la correction.", true);
            api("POST", "articles/" + encodeURIComponent(a.id) + "/corrections", { text: ta.value }).then(function (r) {
              a = r.article; toast("Correction publiée."); renderCorrections();
            }).catch(function (x) { toast(x.message, true); });
          } })));
        }
      }

      function deleteArticle() {
        confirmBox("Cette action est irréversible : l'article, ses traductions et ses corrections seront effacés.", { title: "Supprimer l'article ?", confirm: "Supprimer", danger: true, typed: "SUPPRIMER" }).then(function (ok) {
          if (!ok) return;
          api("DELETE", "articles/" + encodeURIComponent(a.id)).then(function () { dirty = false; toast("Article supprimé."); location.hash = "#/articles"; }).catch(function (x) { toast(x.message, true); });
        });
      }

      /* ── assemblage ── */
      clear(view);
      wd.appendChild(titleBar);
      wd.appendChild(ribbonEl);
      wd.appendChild(h("div", { class: "wd-body" }, canvas, pane));
      wd.appendChild(statusBar);
      view.appendChild(wd);

      ed = window.HNetEditor.create({
        ribbon: ribbonEl, content: contentEl, html: "", ask: ask, pickImage: pickImage, extraTabs: [viewTab],
        onChange: function () { markDirty(); },
        onStats: function (s) {
          clear(statsEl);
          statsEl.appendChild(h("span", { text: s.words + " mot" + (s.words > 1 ? "s" : "") }));
          statsEl.appendChild(h("span", { class: "wd-opt", text: " · " + s.characters + " caractères" }));
          statsEl.appendChild(h("span", { class: "wd-opt", text: " · lecture ≈ " + s.minutes + " min" }));
        }
      });
      if (!editable) ed.editor.setEditable(false);
      showLang(cur);
      renderSources(); renderMainImage(); renderCorrections(); refreshChrome();
      paneBtn.classList.toggle("is-active", paneOn);
      autosize(f.title); autosize(f.excerpt);

      /* brouillon local de secours (connexion ou onglet perdu) */
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

      function onKey(e) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); if (dirty && editable) save(false); }
        if (e.key === "Escape") closeMenu();
      }
      function onResize() { autosize(f.title); autosize(f.excerpt); }
      function beforeUnload(e) { if (dirty) { e.preventDefault(); e.returnValue = ""; } }
      document.addEventListener("keydown", onKey);
      document.addEventListener("click", onDocClick);
      window.addEventListener("resize", onResize);
      window.addEventListener("beforeunload", beforeUnload);
      guard = function () { return !dirty || window.confirm("Des modifications n'ont pas été enregistrées. Quitter quand même ?"); };
      cleanup = function () {
        clearInterval(timer);
        document.removeEventListener("keydown", onKey); document.removeEventListener("click", onDocClick);
        window.removeEventListener("resize", onResize); window.removeEventListener("beforeunload", beforeUnload);
        if (ed) ed.destroy();
      };
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

  /* ───────── Commentaires des lecteurs (modération) ───────── */
  function renderComments(view) {
    var LAB = { en_attente: "À modérer", approuve: "Publiés", refuse: "Refusés", spam: "Indésirables" };
    var filter = h("select", { "aria-label": "Statut" }, [["en_attente", "À modérer"], ["approuve", "Publiés"], ["refuse", "Refusés"], ["spam", "Indésirables"], ["", "Tous"]].map(function (o) { return h("option", { value: o[0], text: o[1] }); }));
    var counts = h("div", { class: "hn-chips", style: "margin-bottom:12px" });
    var box = h("div");
    function act(c, method, path, body, okMsg) {
      return api(method, "comments/" + c.id + (path || ""), body).then(function () { toast(okMsg); load(); }).catch(function (x) { toast(x.message, true); });
    }
    function load() {
      return api("GET", "comments" + (filter.value ? "?status=" + filter.value : "")).then(function (r) {
        clear(counts);
        Object.keys(LAB).forEach(function (k) { counts.appendChild(h("span", { class: "tag", text: LAB[k] + " : " + ((r.counts || {})[k] || 0) })); });
        clear(box);
        if (!r.items.length) { box.appendChild(h("div", { class: "empty-state" }, h("div", { class: "es-icon", text: "💬" }), h("h3", { text: "Aucun commentaire" }), h("p", { text: filter.value === "en_attente" ? "Rien à modérer pour le moment." : "Les commentaires des lecteurs apparaîtront ici." }))); return; }
        r.items.forEach(function (c) {
          var actions = h("div", { class: "hn-actions", style: "padding:0 14px 14px" });
          if (c.status !== "approuve" && !c.staff) actions.appendChild(h("button", { type: "button", class: "hn-btn hn-btn-primary hn-btn-sm", text: "Approuver", onclick: function () { act(c, "PATCH", "", { status: "approuve" }, "Commentaire publié."); } }));
          if (c.status !== "refuse") actions.appendChild(h("button", { type: "button", class: "hn-btn hn-btn-ghost hn-btn-sm", text: "Refuser", onclick: function () { act(c, "PATCH", "", { status: "refuse" }, "Commentaire refusé."); } }));
          if (c.status !== "spam") actions.appendChild(h("button", { type: "button", class: "hn-btn hn-btn-ghost hn-btn-sm", text: "Indésirable", onclick: function () { act(c, "PATCH", "", { status: "spam" }, "Marqué indésirable."); } }));
          if (c.status === "approuve" && !c.parentId && !c.staff) actions.appendChild(h("button", { type: "button", class: "hn-btn hn-btn-navy hn-btn-sm", text: "Répondre en public", onclick: function () {
            ask("Réponse publique de la rédaction", [{ name: "body", label: "Votre réponse", type: "textarea", required: true }], { submit: "Publier la réponse" }).then(function (v) {
              if (v) act(c, "POST", "/reply", { body: v.body }, "Réponse publiée.");
            });
          } }));
          actions.appendChild(h("a", { class: "hn-btn hn-btn-ghost hn-btn-sm", href: "/article/" + encodeURIComponent(c.articleSlug), target: "_blank", rel: "noopener", text: "Voir l'article" }));
          if (c.email) actions.appendChild(h("a", { class: "hn-btn hn-btn-ghost hn-btn-sm", href: "mailto:" + encodeURIComponent(c.email).replace(/%40/g, "@"), text: "Écrire au lecteur" }));
          actions.appendChild(h("button", { type: "button", class: "hn-btn hn-btn-ghost hn-btn-sm", text: "Supprimer", onclick: function () {
            confirmBox("Ce commentaire sera supprimé définitivement.", { title: "Supprimer ?", confirm: "Supprimer" }).then(function (ok) { if (ok) act(c, "DELETE", "", undefined, "Commentaire supprimé."); });
          } }));
          var head = h("div", { class: "hn-msg-h" },
            h("div", null,
              h("strong", { text: c.name }), c.staff ? h("span", { class: "hn-muted", text: " (rédaction)" }) : null,
              h("div", { class: "hn-muted", text: (c.parentName ? "Réponse à " + c.parentName + " · " : "") + "sur « " + (c.articleTitle || c.articleSlug) + " » · " + fmt(c.createdAt) })),
            h("span", { class: "badge " + (c.status === "en_attente" ? "" : "badge-draft"), text: LAB[c.status] || c.status }));
          var text = h("div", { class: "hn-msg-b" }); text.appendChild(document.createTextNode(c.body));
          box.appendChild(h("div", { class: "hn-msg" + (c.status === "en_attente" ? " new" : "") }, head, text, actions));
        });
      });
    }
    filter.addEventListener("change", load);
    clear(view);
    view.appendChild(heading("Commentaires", "Les commentaires des lecteurs sont publiés après votre validation. L'adresse e-mail n'est jamais affichée sur le site."));
    view.appendChild(counts);
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
  /* ───────── Tableau de bord et statistiques (chiffres réels uniquement) ───────── */
  var ACTIONS = {
    "article.creation": "a créé un article", "article.modification": "a modifié un article", "article.suppression": "a supprimé un article",
    "article.correction": "a ajouté une correction", "article.sponsorise": "a changé le marquage sponsorisé",
    "media.televersement": "a ajouté une image", "media.suppression": "a supprimé une image",
    "contact.statut": "a traité un message", "abonnes.export": "a exporté les abonnés",
    "equipe.creation": "a créé une fiche d'équipe", "equipe.modification": "a modifié une fiche d'équipe", "equipe.suppression": "a supprimé une fiche d'équipe",
    "partenaire.creation": "a ajouté un partenaire", "partenaire.modification": "a modifié un partenaire", "partenaire.suppression": "a supprimé un partenaire",
    "offre.creation": "a créé une offre d'emploi", "offre.modification": "a modifié une offre d'emploi", "offre.suppression": "a supprimé une offre d'emploi",
    "reglages.modification": "a modifié les réglages du site", "installation.admin": "a créé le premier compte administrateur", "mot_de_passe.modifie": "a changé son mot de passe", "compte.creation": "a créé un compte", "compte.modification": "a modifié un compte",
  };
  function actionLabel(a) {
    if (ACTIONS[a]) return ACTIONS[a];
    if (/^article\.statut\./.test(a)) return /publie_auto/.test(a) ? "— publication programmée effectuée" : "a changé le statut d'un article";
    return "a effectué une action";
  }
  function ago(iso) {
    var m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (m < 1) return "à l'instant"; if (m < 60) return "il y a " + m + " min";
    var hh = Math.round(m / 60); if (hh < 24) return "il y a " + hh + " h";
    var d = Math.round(hh / 24); return "il y a " + d + " j";
  }
  function delta(cur, prev) {
    if (!prev) return h("span", { class: "hn-pill", text: cur ? "1re période mesurée" : "Pas encore de données" });
    var pct = Math.round((cur - prev) / prev * 100);
    return h("span", { class: "hn-pill " + (pct >= 0 ? "up" : "down") }, h("span", { html: ico(pct >= 0 ? "up" : "down", 12) }), (pct >= 0 ? "+" : "") + pct + " %");
  }
  function emptyNote(text) { return h("p", { class: "hn-muted hn-empty-note", text: text }); }
  // État vide : lignes en pointillés (aucun chiffre, aucune fausse donnée) + message honnête
  function ghostRows(text, n) {
    var rows = []; for (var i = 0; i < (n || 3); i++) rows.push(h("li", null, h("span", { class: "hn-ghost-c" }), h("span", { class: "hn-ghost-l", style: "width:" + (88 - i * 18) + "%" })));
    return h("div", { class: "hn-ghost" }, h("ul", { "aria-hidden": "true" }, rows), h("p", { class: "hn-muted", text: text }));
  }
  function vbars(perDay) {
    var max = Math.max.apply(null, [1].concat(perDay.map(function (d) { return d.views; })));
    var total = perDay.reduce(function (a, d) { return a + d.views; }, 0);
    var step = perDay.length > 45 ? 14 : perDay.length > 14 ? 7 : 1;
    var dstr = function (d) { return new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }); };
    var labels = h("div", { class: "hn-vlbl" }, perDay.map(function (d, i) { return h("span", { "data-t": (perDay.length - 1 - i) % step === 0 ? dstr(d.day) : "" }); }));
    if (!total) {
      return h("div", null, h("div", { class: "hn-vbars empty", "aria-hidden": "true" }, perDay.map(function (d, i) { return h("div", { class: "vb" }, h("i", { style: "height:" + (38 + (i * 37) % 52) + "%" })); })), labels,
        h("p", { class: "hn-muted hn-chart-note", text: "Aucune lecture mesurée sur cette période : les lectures d'articles publiés apparaîtront ici." }));
    }
    var peak = perDay.reduce(function (m, d) { return d.views > m.views ? d : m; }, perDay[0]);
    return h("div", { role: "img", "aria-label": "Lectures par jour : " + fmtN(total) + " au total, maximum " + fmtN(peak.views) + " le " + dstr(peak.day) },
      h("div", { class: "hn-vbars" }, perDay.map(function (d) {
        var pc = Math.max(3, Math.round(d.views / max * 100));
        return h("div", { class: "vb" + (d === peak ? " peak" : ""), "data-v": d === peak ? fmtN(d.views) : null, style: "--h:" + pc + "%", title: dstr(d.day) + " : " + fmtN(d.views) + " lecture" + (d.views > 1 ? "s" : "") }, h("i"));
      })), labels);
  }
  function rankList(items, o) {
    if (!items || !items.length) return ghostRows(o.empty);
    var max = Math.max.apply(null, items.map(function (x) { return x.views; })) || 1;
    return h("ol", { class: "hn-rank" }, items.map(function (x, i) {
      return h("li", null,
        o.avatar ? h("span", { class: "hn-av", "aria-hidden": "true", text: o.name(x).trim().charAt(0).toUpperCase() }) : h("span", { class: "hn-rk", text: i + 1 }),
        h("div", { class: "hn-rk-main" },
          h("div", { class: "hn-rk-top" }, h("span", { class: "hn-rk-name", text: o.name(x) }), h("strong", { text: fmtN(x.views) })),
          o.meta ? h("small", { class: "hn-muted", text: o.meta(x) }) : null,
          h("div", { class: "hn-prog" }, h("i", { style: "width:" + Math.max(2, Math.round(x.views / max * 100)) + "%" }))));
    }));
  }
  function card(title, sub, body, link, cls) {
    return h("section", { class: "hn-card hn-pad" + (cls ? " " + cls : "") },
      h("div", { class: "hn-card-head" }, h("div", null, h("h2", { text: title }), sub ? h("p", { class: "hn-sub2", text: sub }) : null), link || null),
      h("div", { class: "hn-card-body" }, body));
  }
  function linkBtn(text, href) { return h("a", { class: "hn-more", href: href }, text, h("span", { html: ico("ext", 13) })); }
  // Carte indicateur : titre, flèche vers le détail, grand chiffre, ligne de contexte
  function kpiCard(k) {
    return h("div", { class: "hn-kpi" + (k.dark ? " dark" : "") },
      h("div", { class: "hn-kpi-top" }, h("span", { class: "hn-kpi-lab", text: k.lab }), h("a", { class: "hn-go", href: k.href, "aria-label": "Ouvrir : " + k.lab, html: ico("ext", 15) })),
      h("strong", { class: "hn-kpi-val", text: fmtN(k.val) }),
      h("div", { class: "hn-kpi-foot" }, k.extra || h("span", { class: "hn-foot" }, h("span", { class: "hn-foot-ic", html: ico(k.ic, 13) }), k.sub)));
  }
  // Demi-anneau : répartition réelle des articles par statut
  function donut(parts, total) {
    var R = 80, L = Math.PI * R, off = 0, segs = [];
    parts.forEach(function (p) {
      if (!p.n || !total) return;
      var len = p.n / total * L;
      segs.push('<path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="' + p.color + '" stroke-width="26" stroke-dasharray="' + len.toFixed(2) + " " + (L + 1).toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '"/>');
      off += len;
    });
    var pubPct = total ? Math.round(parts[0].n / total * 100) : 0;
    return h("div", { class: "hn-donut" },
      h("div", { class: "hn-donut-svg", role: "img", "aria-label": total ? pubPct + " % des articles sont publiés" : "Aucun article pour le moment" },
        h("span", { html: '<svg viewBox="0 0 200 108" width="100%" aria-hidden="true"><path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="#E5E7EB" stroke-width="26"/>' + segs.join("") + "</svg>" }),
        h("div", { class: "hn-donut-c" }, h("strong", { text: total ? pubPct + " %" : "—" }), h("small", { text: total ? "publiés" : "aucun article" }))),
      h("ul", { class: "hn-legend" }, parts.map(function (p) { return h("li", null, h("i", { style: "background:" + p.color }), p.label + " ", h("strong", { text: fmtN(p.n) })); })));
  }
  var artName = function (x) { return x.title || x.slug; };

  function renderDashboard(view) {
    return ensureMeta().then(function () { return api("GET", "stats/overview?days=30"); }).then(function (o) {
      var pub = o.articles.publie || 0, dra = o.articles.brouillon || 0, prog = o.articles.programme || 0, arc = o.articles.archive || 0;
      var total = pub + dra + prog + arc;
      var newBtn = can("article.create") ? h("button", { type: "button", class: "hn-btn hn-btn-navy", text: "+ Nouvel article", onclick: function () { S.openNew = true; location.hash = "#/articles"; } }) : null;
      clear(view);
      view.appendChild(heading("Tableau de bord", "Suivez, publiez et gérez votre média. Chiffres réels, mesurés par le site.",
        h("div", { class: "hn-head-actions" }, newBtn)));

      var vdelta = o.views.prev ? Math.round((o.views.cur - o.views.prev) / o.views.prev * 100) : null;
      var k = [
        { dark: true, lab: "Pages vues · 30 jours", val: o.views.cur, href: "#/stats", ic: "eye",
          extra: h("span", { class: "hn-foot" }, h("span", { class: "hn-foot-ic", html: ico(vdelta === null || vdelta >= 0 ? "up" : "down", 13) }),
            vdelta === null ? (o.views.cur ? "Première période mesurée" : "Pas encore de données") : (vdelta >= 0 ? "+" : "") + vdelta + " % sur la période précédente") },
        { lab: "Articles publiés", val: pub, href: "#/articles", ic: "doc", sub: total ? "sur " + fmtN(total) + " article" + (total > 1 ? "s" : "") : "Aucun article" },
        { lab: "Brouillons", val: dra, href: "#/articles", ic: "pen", sub: "à terminer" },
      ];
      if (o.messagesNew !== undefined) k.push({ lab: "Messages à lire", val: o.messagesNew, href: "#/messages", ic: "mail", sub: "formulaire de contact" });
      else k.push({ lab: "Programmés", val: prog, href: "#/articles", ic: "clock", sub: "en attente de publication" });
      view.appendChild(h("div", { class: "hn-kpis" }, k.map(kpiCard)));

      // Prochaine publication
      var nx = o.nextScheduled ? new Date(o.nextScheduled) : null;
      var remind = nx
        ? h("div", { class: "hn-remind" }, h("small", { class: "hn-muted", text: "Programmée pour le" }),
            h("strong", { text: nx.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) }),
            h("span", { class: "hn-muted", text: "à " + nx.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) + (prog > 1 ? " · " + prog + " articles programmés" : "") }),
            h("a", { class: "hn-btn hn-btn-navy", href: "#/articles", text: "Voir les articles" }))
        : h("div", { class: "hn-remind" }, h("span", { class: "hn-remind-ic", html: ico("clock", 26) }), h("strong", { text: "Aucune publication programmée" }),
            h("span", { class: "hn-muted", text: "Programmez un article depuis l'éditeur pour qu'il paraisse à l'heure choisie." }),
            h("a", { class: "hn-btn hn-btn-navy", href: "#/articles", text: "Voir les articles" }));
      var todo = [];
      if (o.messagesNew !== undefined) todo.push(["mail", "Messages à lire", o.messagesNew, "#/messages"]);
      todo.push(["pen", "Brouillons", dra, "#/articles"], ["clock", "Programmés", prog, "#/articles"]);
      if (o.jobsOpen !== undefined) todo.push(["case", "Offres ouvertes", o.jobsOpen, "#/offres"]);
      var todoList = h("ul", { class: "hn-rows" }, todo.map(function (t) {
        return h("li", null, h("a", { href: t[3] }, h("span", { class: "hn-row-ic", html: ico(t[0], 18) }), h("span", { class: "hn-row-t", text: t[1] }), h("strong", { class: t[2] > 0 ? "on" : "", text: fmtN(t[2]) })));
      }));
      view.appendChild(h("div", { class: "hn-bento b1" },
        card("Lectures par jour", "30 derniers jours", vbars(o.perDay), linkBtn("Détails", "#/stats")),
        card("Prochaine publication", null, remind),
        card("À traiter", "Ce qui attend votre action", todoList)));

      var artMeta = function (x) { return catLabel(x.category); };
      view.appendChild(h("div", { class: "hn-bento b2" },
        card("Articles les plus lus", "30 derniers jours", rankList(o.topArticles.slice(0, 5), { empty: "Pas encore de lectures mesurées.", name: artName, meta: artMeta }), linkBtn("Tout voir", "#/stats")),
        card("Rédacteurs les plus lus", "Lectures cumulées de leurs articles", rankList(o.topAuthors.slice(0, 5), { avatar: true, empty: "Pas encore de lectures mesurées.", name: function (x) { return x.name; }, meta: function (x) { return x.articles + " article" + (x.articles > 1 ? "s" : "") + " lu" + (x.articles > 1 ? "s" : ""); } }), linkBtn("Tout voir", "#/stats")),
        card("Répartition des articles", "Par statut", donut([
          { label: "Publiés", n: pub, color: "#0A1F44" }, { label: "Brouillons", n: dra, color: "#FF6B00" },
          { label: "Programmés", n: prog, color: "#00C8F0" }, { label: "Archivés", n: arc, color: "#9CA3AF" }], total))));

      var actBody = !o.activity ? null : (o.activity.length ? h("ul", { class: "hn-act" }, o.activity.slice(0, 5).map(function (a) {
        return h("li", null, h("span", { class: "hn-dot", "aria-hidden": "true" }), h("div", null, h("span", null, h("strong", { text: a.who || "Système" }), " " + actionLabel(a.action)), h("small", { class: "hn-muted", text: ago(a.at) })));
      })) : emptyNote("Aucune activité récente."));
      view.appendChild(h("div", { class: "hn-bento b3" },
        card("Rubriques les plus lues", "30 derniers jours", rankList(o.topCategories.slice(0, 5), { empty: "Pas encore de lectures mesurées.", name: function (x) { return x.label; } })),
        actBody ? card("Activité récente", "Dernières modifications de l'équipe", actBody, null, "dark")
                : card("Mots-clés les plus lus", "30 derniers jours", rankList(o.topTags.slice(0, 5), { empty: "Pas encore de lectures mesurées.", name: function (x) { return "#" + x.label; } }))));
    });
  }

  function renderStats(view) {
    var days = h("select", { "aria-label": "Période" }, [["7", "7 jours"], ["30", "30 jours"], ["90", "90 jours"]].map(function (o) { return h("option", { value: o[0], text: o[1] }); }));
    days.value = "30";
    var box = h("div");
    function load() {
      return ensureMeta().then(function () { return api("GET", "stats/overview?days=" + days.value); }).then(function (o) {
        clear(box);
        var lab = days.value + " derniers jours";
        var vd = o.views.prev ? Math.round((o.views.cur - o.views.prev) / o.views.prev * 100) : null;
        box.appendChild(h("div", { class: "hn-kpis three" }, [
          { dark: true, lab: "Pages vues", val: o.views.cur, href: "#/stats", ic: "eye", extra: h("span", { class: "hn-foot" }, h("span", { class: "hn-foot-ic", html: ico(vd === null || vd >= 0 ? "up" : "down", 13) }), vd === null ? lab : (vd >= 0 ? "+" : "") + vd + " % · avant : " + fmtN(o.views.prev)) },
          { lab: "Moyenne par jour", val: Math.round(o.views.cur / o.days), href: "#/stats", ic: "chart", sub: lab },
          { lab: "Articles publiés", val: o.articles.publie || 0, href: "#/articles", ic: "doc", sub: o.scope === "own" ? "parmi vos articles" : "au total" }].map(kpiCard)));
        box.appendChild(card("Lectures par jour", lab, vbars(o.perDay)));
        var empty = "Pas encore de lectures mesurées sur cette période.";
        box.appendChild(h("div", { class: "hn-cols" },
          card("Articles les plus lus", lab, rankList(o.topArticles, { empty: empty, name: artName, meta: function (x) { return catLabel(x.category); } })),
          card("Rédacteurs les plus lus", "Lectures cumulées de leurs articles", rankList(o.topAuthors, { empty: empty, name: function (x) { return x.name; }, meta: function (x) { return x.articles + " article" + (x.articles > 1 ? "s" : "") + " lu" + (x.articles > 1 ? "s" : ""); } }))));
        box.appendChild(h("div", { class: "hn-cols" },
          card("Rubriques les plus lues", lab, rankList(o.topCategories, { empty: empty, name: function (x) { return x.label; } })),
          card("Mots-clés les plus lus", lab, rankList(o.topTags, { empty: empty, name: function (x) { return "#" + x.label; } }))));
      });
    }
    days.addEventListener("change", load);
    clear(view);
    view.appendChild(heading("Statistiques", "Lectures d'articles et de pages. Les robots et les visiteurs qui refusent le suivi ne sont pas comptés ; aucune adresse IP n'est conservée.", h("div", { class: "hn-filters", style: "margin:0" }, days)));
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
      view.appendChild(h("div", { class: "hn-card" }, h("h2", { text: "Droits par rôle" }), h("ul", { style: "list-style:none;font-size:13px;line-height:1.2" }, S.meta.roles.map(function (r) { return h("li", null, h("strong", { text: r.label + " : " }), r.description); }))));
      view.appendChild(box);
      return load();
    });
  }

  /* ───────── Listes simples (équipe, partenaires, offres) ───────── */
  // cfg : { title, sub, path, newLabel, empty, cols:[[titre, fn(item)]], fields(item)→champs, body(valeurs, item)→JSON,
  //         extra(item, reload)→boutons, removeMsg(item) }
  function renderList(view, cfg) {
    var box = h("div");
    function load() {
      return api("GET", cfg.path).then(function (r) {
        clear(box);
        if (!r.items.length) { box.appendChild(h("div", { class: "hn-card" }, h("p", { class: "hn-muted", text: cfg.empty }))); return; }
        box.appendChild(h("table", { class: "hn-table stack" },
          h("thead", null, h("tr", null, cfg.cols.map(function (c) { return h("th", { text: c[0] }); }).concat([h("th", { text: "" })]))),
          h("tbody", null, r.items.map(function (it) {
            var acts = h("td", { style: "white-space:nowrap" },
              h("button", { type: "button", class: "hn-btn hn-btn-ghost hn-btn-sm", text: "Modifier", onclick: function () { edit(it); } }), " ");
            (cfg.extra ? cfg.extra(it, load) : []).forEach(function (b) { acts.appendChild(b); acts.appendChild(document.createTextNode(" ")); });
            if (cfg.removeMsg) acts.appendChild(h("button", { type: "button", class: "hn-btn hn-btn-ghost hn-btn-sm", text: "Supprimer", onclick: function () { remove(it); } }));
            return h("tr", null, cfg.cols.map(function (c) { return h("td", { "data-l": c[0], text: String(c[1](it) == null ? "" : c[1](it)) }); }).concat([acts]));
          }))));
      });
    }
    function edit(it) {
      ask(it ? "Modifier" : cfg.newLabel.replace(/^\+ /, ""), cfg.fields(it), { submit: "Enregistrer", intro: cfg.intro }).then(function (v) {
        if (!v) return;
        var body = cfg.body(v, it);
        api(it ? "PUT" : "POST", cfg.path + (it ? "/" + it[cfg.id || "id"] : ""), body)
          .then(function () { toast("Enregistré."); load(); })
          .catch(function (x) { toast(x.message, true); });
      });
    }
    function remove(it) {
      confirmBox(cfg.removeMsg(it), { title: "Supprimer", danger: true, confirm: "Supprimer" }).then(function (ok) {
        if (!ok) return;
        api("DELETE", cfg.path + "/" + it.id).then(function () { toast("Supprimé."); load(); }).catch(function (x) { toast(x.message, true); });
      });
    }
    clear(view);
    view.appendChild(heading(cfg.title, cfg.sub, cfg.newLabel ? h("button", { type: "button", class: "hn-btn hn-btn-primary", text: cfg.newLabel, onclick: function () { edit(null); } }) : null));
    view.appendChild(h("div", { class: "update-note", style: "margin-bottom:14px", text: S.meta && S.meta.siteRebuild
      ? "Chaque changement met le site à jour automatiquement (1 à 2 minutes)."
      : "La mise à jour automatique du site n'est pas configurée : les changements n'apparaîtront qu'au prochain déploiement." }));
    view.appendChild(box);
    return load();
  }
  var YESNO = [["1", "Oui"], ["0", "Non"]];

  function renderTeam(view) {
    var SOC = [["twitter", "X (Twitter)"], ["facebook", "Facebook"], ["linkedin", "LinkedIn"], ["youtube", "YouTube"], ["instagram", "Instagram"]];
    return ensureMeta().then(function () {
      return renderList(view, {
        title: "Équipe", sub: "Les fiches affichées sur la page « Notre équipe » et sous chaque article signé.",
        path: "team", newLabel: "+ Nouvelle fiche", empty: "Aucune fiche d'équipe pour le moment.",
        intro: "Seules des informations réelles : rien n'est inventé ni affiché si vous laissez le champ vide.",
        cols: [["Nom", function (a) { return a.name; }], ["Fonction", function (a) { return a.role || "—"; }], ["Articles", function (a) { return a.articles; }], ["Photo", function (a) { return a.photo ? "Oui" : "Non"; }]],
        fields: function (a) {
          return [{ name: "name", label: "Nom", required: true, max: 100, value: a ? a.name : "" },
            { name: "role", label: "Fonction (ex. Reporter)", max: 120, value: a ? a.role || "" : "" },
            { name: "bio", label: "Présentation", type: "textarea", max: 1500, value: a ? a.bio || "" : "" }]
            .concat(SOC.map(function (c) { return { name: c[0], label: "Lien " + c[1] + " (https://…, facultatif)", type: "url", max: 300, value: a && a.social ? a.social[c[0]] || "" : "" }; }));
        },
        body: function (v, a) {
          var social = {}; SOC.forEach(function (c) { if (v[c[0]]) social[c[0]] = v[c[0]]; });
          return { name: v.name, role: v.role, bio: v.bio, social: social, photo: a ? a.photo || "" : "" };
        },
        extra: function (a, reload) {
          return [h("button", { type: "button", class: "hn-btn hn-btn-ghost hn-btn-sm", text: a.photo ? "Changer la photo" : "Photo", onclick: function () {
            pickImage(a.photo ? { src: a.photo, alt: a.name, caption: "", credit: "" } : null, { title: "Photo de " + a.name }).then(function (v) {
              if (!v) return;
              api("PUT", "team/" + a.id, { name: a.name, role: a.role, bio: a.bio, social: a.social || {}, photo: v.src })
                .then(function () { toast("Photo enregistrée."); reload(); }).catch(function (x) { toast(x.message, true); });
            });
          } })];
        },
        removeMsg: function (a) { return "Supprimer la fiche de " + a.name + " ? Impossible tant que cette personne signe des articles."; },
      });
    });
  }

  function renderCategories(view) {
    return ensureMeta().then(function () {
      return renderList(view, {
        title: "Rubriques", sub: "Noms et descriptions des rubriques, en français et en anglais, et leur ordre dans le menu. L'adresse de chaque rubrique ne change jamais.",
        path: "categories", newLabel: null, empty: "Aucune rubrique.", id: "slug",
        intro: "Laissez le nom anglais vide pour reprendre le nom français sur la version anglaise.",
        cols: [["Ordre", function (c) { return c.position; }], ["Français", function (c) { return c.label; }], ["English", function (c) { return c.labelEn || "—"; }], ["Adresse", function (c) { return "/" + c.slug; }]],
        fields: function (c) {
          return [{ name: "label", label: "Nom (français)", required: true, max: 40, value: c.label },
            { name: "labelEn", label: "Nom (anglais)", max: 40, value: c.labelEn || "" },
            { name: "description", label: "Description (français)", type: "textarea", max: 300, value: c.description || "" },
            { name: "descriptionEn", label: "Description (anglais)", type: "textarea", max: 300, value: c.descriptionEn || "" },
            { name: "position", label: "Ordre dans le menu (0 = en premier)", type: "number", min: 0, value: String(c.position) }];
        },
        body: function (v) { return { label: v.label, labelEn: v.labelEn, description: v.description, descriptionEn: v.descriptionEn, position: v.position }; },
      });
    });
  }

  function renderPartners(view) {
    var KINDS = [["partenaire", "Partenaire"], ["annonceur", "Annonceur"], ["institution", "Institution"]];
    var label = { partenaire: "Partenaire", annonceur: "Annonceur", institution: "Institution" };
    return ensureMeta().then(function () {
      return renderList(view, {
        title: "Partenaires", sub: "Affichés sur la page « Partenaires ». Seuls les partenaires actifs sont publics.",
        path: "partners", newLabel: "+ Nouveau partenaire", empty: "Aucun partenaire pour le moment.",
        intro: "N'ajoutez que de vrais partenaires, avec leur accord.",
        cols: [["Nom", function (p) { return p.name; }], ["Type", function (p) { return label[p.kind] || p.kind; }], ["Visible", function (p) { return p.active ? "Oui" : "Non"; }], ["Site", function (p) { return p.url || "—"; }]],
        fields: function (p) {
          return [{ name: "name", label: "Nom", required: true, max: 120, value: p ? p.name : "" },
            { name: "url", label: "Site web (https://…, facultatif)", type: "url", max: 500, value: p ? p.url || "" : "" },
            { name: "description", label: "Description (facultatif)", type: "textarea", max: 500, value: p ? p.description || "" : "" },
            { name: "kind", label: "Type", type: "select", value: p ? p.kind : "partenaire", options: KINDS },
            { name: "active", label: "Afficher sur le site ?", type: "select", value: !p || p.active ? "1" : "0", options: YESNO },
            { name: "position", label: "Ordre d'affichage (0 = en premier)", type: "number", min: 0, value: p ? String(p.position) : "0" }];
        },
        body: function (v) { return { name: v.name, url: v.url, description: v.description, kind: v.kind, active: v.active === "1", position: v.position }; },
        removeMsg: function (p) { return "Supprimer le partenaire « " + p.name + " » ?"; },
      });
    });
  }

  function renderJobs(view) {
    var ST = [["brouillon", "Brouillon (non publié)"], ["ouvert", "Ouvert (publié)"], ["ferme", "Fermé (non publié)"]];
    var stLabel = { brouillon: "Brouillon", ouvert: "Ouvert", ferme: "Fermé" };
    return ensureMeta().then(function () {
      return renderList(view, {
        title: "Offres d'emploi", sub: "Affichées sur la page « Carrières » seulement lorsqu'elles sont « Ouvertes ».",
        path: "jobs", newLabel: "+ Nouvelle offre", empty: "Aucune offre pour le moment.",
        intro: "Pour ouvrir une offre, indiquez comment postuler (e-mail ou lien).",
        cols: [["Intitulé", function (j) { return j.title; }], ["Statut", function (j) { return stLabel[j.status] || j.status; }], ["Contrat", function (j) { return j.contract || "—"; }], ["Lieu", function (j) { return j.location || "—"; }], ["Date limite", function (j) { return j.closesAt ? new Date(j.closesAt).toLocaleDateString("fr-FR") : "—"; }]],
        fields: function (j) {
          return [{ name: "title", label: "Intitulé du poste", required: true, max: 150, value: j ? j.title : "" },
            { name: "contract", label: "Contrat (ex. CDD, pigiste)", max: 60, value: j ? j.contract || "" : "" },
            { name: "location", label: "Lieu", max: 100, value: j ? j.location || "" : "" },
            { name: "description", label: "Description du poste", type: "textarea", required: true, max: 4000, value: j ? j.description || "" : "" },
            { name: "applyEmail", label: "E-mail de candidature", type: "email", max: 254, value: j ? j.applyEmail || "" : "" },
            { name: "applyUrl", label: "ou lien de candidature (https://…)", type: "url", max: 500, value: j ? j.applyUrl || "" : "" },
            { name: "closesAt", label: "Date limite (facultatif)", type: "date", value: j && j.closesAt ? String(j.closesAt).slice(0, 10) : "" },
            { name: "status", label: "Statut", type: "select", value: j ? j.status : "brouillon", options: ST }];
        },
        body: function (v) { return { title: v.title, contract: v.contract, location: v.location, description: v.description, applyEmail: v.applyEmail, applyUrl: v.applyUrl, closesAt: v.closesAt ? v.closesAt + "T23:59:59Z" : "", status: v.status }; },
        removeMsg: function (j) { return "Supprimer l'offre « " + j.title + " » ?"; },
      });
    });
  }

  /* ───────── Médias ───────── */
  function renderMedia(view) {
    var box = h("div");
    var size = function (n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + " Mo" : Math.max(1, Math.round(n / 1024)) + " Ko"; };
    function load() {
      return api("GET", "media").then(function (r) {
        clear(box);
        if (!r.items.length) { box.appendChild(h("div", { class: "hn-card" }, h("p", { class: "hn-muted", text: "Aucune image pour le moment. Ajoutez-en depuis l'éditeur d'un article." }))); return; }
        box.appendChild(h("table", { class: "hn-table stack" },
          h("thead", null, h("tr", null, ["Image", "Taille", "Ajoutée", "Par", "Utilisation", ""].map(function (c) { return h("th", { text: c }); }))),
          h("tbody", null, r.items.map(function (m) {
            return h("tr", null,
              h("td", { "data-l": "Image" }, h("img", { src: m.url, alt: m.alt || "", loading: "lazy", style: "width:72px;height:54px;object-fit:cover;border-radius:6px;display:block" })),
              h("td", { "data-l": "Taille", text: m.width + " × " + m.height + " · " + size(m.size) }),
              h("td", { "data-l": "Ajoutée", class: "hn-muted", text: fmt(m.createdAt) }),
              h("td", { "data-l": "Par", text: m.by || "—" }),
              h("td", { "data-l": "Utilisation", text: m.usage > 0 ? "Utilisée (" + m.usage + ")" : "Inutilisée" }),
              h("td", null, h("button", { type: "button", class: "hn-btn hn-btn-ghost hn-btn-sm", text: "Supprimer", disabled: m.usage > 0, title: m.usage > 0 ? "Retirez d'abord l'image des contenus où elle apparaît." : "", onclick: function () {
                confirmBox("Supprimer définitivement cette image ?", { title: "Supprimer l'image", danger: true, confirm: "Supprimer" }).then(function (ok) {
                  if (!ok) return;
                  api("DELETE", "media/" + m.id).then(function () { toast("Image supprimée."); load(); }).catch(function (x) { toast(x.message, true); });
                });
              } })));
          }))));
        box.appendChild(h("p", { class: "hn-hint", text: "Les 60 images les plus récentes. Une image utilisée dans un article, une photo d'équipe ou un partenaire ne peut pas être supprimée." }));
      });
    }
    function cleanupBtn() {
      return h("button", { type: "button", class: "hn-btn hn-btn-ghost", text: "Supprimer les images inutilisées", onclick: function () {
        api("GET", "media/unused").then(function (u) {
          if (!u.count) return toast("Aucune image inutilisée de plus de 24 heures.");
          confirmBox(u.count + " image" + (u.count > 1 ? "s" : "") + " (" + size(u.bytes) + ") ne sert" + (u.count > 1 ? "ent" : "") + " nulle part (ni article, ni photo d'équipe, ni partenaire) et ont plus de 24 heures. Elles seront supprimées définitivement.", { title: "Supprimer les images inutilisées ?", danger: true, confirm: "Supprimer", typed: "SUPPRIMER" }).then(function (ok) {
            if (!ok) return;
            api("POST", "media/cleanup", {}).then(function (r) { toast(r.deleted + " image" + (r.deleted > 1 ? "s supprimées" : " supprimée") + "."); load(); }).catch(function (x) { toast(x.message, true); });
          });
        }).catch(function (x) { toast(x.message, true); });
      } });
    }
    clear(view);
    view.appendChild(heading("Médias", "Images téléversées depuis l'éditeur d'articles. Vous ne voyez que les vôtres, sauf droit de gestion de la médiathèque.", can("media.manage") ? cleanupBtn() : null));
    view.appendChild(box);
    return load();
  }

  /* ───────── Pages fixes (À propos, Charte, Publicité, CGU, Confidentialité, Cookies), en français et en anglais ───────── */
  function renderPages(view) {
    return ensureMeta().then(function () { return api("GET", "pages"); }).then(function (r) {
      clear(view);
      view.appendChild(heading("Pages du site", "Modifiez le texte des pages fixes, en français et en anglais, avec le même éditeur que les articles. Tant qu'une version n'est pas modifiée, le site garde son texte d'origine."));
      view.appendChild(h("div", { class: "update-note", style: "margin-bottom:14px", text: S.meta && S.meta.siteRebuild
        ? "Chaque enregistrement met le site à jour automatiquement (1 à 2 minutes)."
        : "La mise à jour automatique du site n'est pas configurée : les changements n'apparaîtront qu'au prochain déploiement." }));
      var LBL = { fr: "Français", en: "English" };
      view.appendChild(h("table", { class: "hn-table stack" },
        h("thead", null, h("tr", null, ["Page", "Version française", "Version anglaise"].map(function (c) { return h("th", { text: c }); }))),
        h("tbody", null, r.items.map(function (p) {
          function cell(lang) {
            var v = p.versions[lang];
            return h("td", { "data-l": LBL[lang] }, h("div", { style: "margin-bottom:6px" }, h("span", { text: v.custom ? "Modifiée" : "Texte d'origine" }), v.updatedAt ? h("span", { class: "hn-muted", text: " · " + fmt(v.updatedAt) }) : null),
              h("a", { class: "hn-btn hn-btn-ghost hn-btn-sm", href: "#/pages/" + p.slug + "/" + lang, text: "Modifier" }), " ",
              h("a", { class: "hn-btn hn-btn-ghost hn-btn-sm", href: (lang === "en" ? "/en/" : "/") + p.slug, target: "_blank", rel: "noopener", text: "Voir" }));
          }
          return h("tr", null, h("td", { "data-l": "Page" }, h("strong", { text: p.defaultTitle }), h("div", { class: "hn-muted", text: "/" + p.slug })), cell("fr"), cell("en"));
        }))));
    });
  }

  // Texte d'origine d'une page : lu sur la page publique (même site), mis en forme pour l'éditeur.
  function defaultPageHtml(slug, lang) {
    return fetch((lang === "en" ? "/en/" : "/") + slug + ".html", { credentials: "omit" }).then(function (r) {
      if (!r.ok) throw new Error("Texte d'origine introuvable.");
      return r.text();
    }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, "text/html");
      var wrap = doc.querySelector(".static-wrap");
      if (!wrap) return "";
      var h1 = wrap.querySelector("h1"); if (h1) h1.remove();
      Array.prototype.forEach.call(wrap.querySelectorAll(".static-grid"), function (g) {
        var ul = doc.createElement("ul");
        Array.prototype.forEach.call(g.querySelectorAll(".static-card"), function (c) {
          var li = doc.createElement("li"), st = doc.createElement("strong");
          st.textContent = (c.querySelector("strong") || {}).textContent || "";
          li.appendChild(st); li.appendChild(doc.createTextNode(" — " + ((c.querySelector("span") || {}).textContent || "")));
          ul.appendChild(li);
        });
        g.replaceWith(ul);
      });
      Array.prototype.forEach.call(wrap.querySelectorAll(".dev-notice"), function (n) { var p = doc.createElement("p"), em = doc.createElement("em"); em.textContent = n.textContent; p.appendChild(em); n.replaceWith(p); });
      return wrap.innerHTML;
    });
  }

  function renderPageEdit(view, slug, lang) {
    if (lang !== "fr" && lang !== "en") { location.hash = "#/pages"; return Promise.resolve(); }
    var q = "?lang=" + lang;
    return Promise.all([ensureMeta(), api("GET", "pages/" + encodeURIComponent(slug) + q), loadEditor()]).then(function (res) {
      var pg = res[1].page;
      return (pg.content !== null ? Promise.resolve(pg.content) : defaultPageHtml(slug, lang)).then(function (startHtml) {
        var dirty = false, ed = null;
        var title = h("input", { id: "pg-title", class: "wd-titlein", type: "text", maxlength: 120, value: pg.title, "aria-label": "Titre de la page", style: "height:auto" });
        var desc = h("textarea", { id: "pg-desc", rows: 2, maxlength: 300, "aria-label": "Description pour les moteurs de recherche", placeholder: "Description pour les moteurs de recherche (facultatif)", class: "wd-excerpt" });
        desc.value = pg.description || "";
        var contentEl = h("div", { class: "hn-ed-content article-body", id: "pg-editor" });
        var saveState = h("span", { class: "wd-savestate", "aria-live": "polite" });
        var statsEl = h("span", { class: "wd-stats", "aria-live": "polite" });
        var ribbonEl = h("div", { class: "wd-ribbon" });
        var badge = h("span", { class: "wd-status", text: (lang === "en" ? "English · " : "Français · ") + (pg.custom ? "Modifiée" : "Texte d'origine") });
        function mark() { dirty = true; saveBtn.disabled = false; saveState.textContent = "Modifications non enregistrées"; }
        var saveBtn = h("button", { type: "button", class: "wd-tbtn wd-save", disabled: true, onclick: save }, h("span", { class: "wd-tlbl", text: "Enregistrer" }));
        var resetBtn = h("button", { type: "button", class: "wd-tbtn", hidden: !pg.custom, onclick: reset }, h("span", { class: "wd-tlbl", text: "Rétablir l'original" }));
        var titleBar = h("header", { class: "wd-title" },
          h("a", { class: "wd-back", href: "#/pages", "aria-label": "Retour à la liste des pages", title: "Retour aux pages", html: pageIcon("back", 20) }),
          h("div", { class: "wd-doc" }, h("span", { class: "wd-docname", text: pg.defaultTitle }), badge),
          h("div", { class: "wd-actions" }, saveBtn, resetBtn, h("a", { class: "wd-tbtn", href: (lang === "en" ? "/en/" : "/") + slug, target: "_blank", rel: "noopener" }, h("span", { class: "wd-tlbl", text: "Voir la page" }))));
        var sheet = h("article", { class: "wd-sheet" }, title, desc, h("hr", { class: "wd-rule" }), contentEl);
        var wd = h("div", { class: "wd" }, titleBar, ribbonEl, h("div", { class: "wd-body" }, h("div", { class: "wd-canvas" }, sheet)), h("footer", { class: "wd-statusbar" }, statsEl, saveState));
        clear(view); view.appendChild(wd);
        ed = window.HNetEditor.create({
          ribbon: ribbonEl, content: contentEl, html: startHtml, ask: ask, pickImage: pickImage,
          onChange: function () { mark(); },
          onStats: function (st) { clear(statsEl); statsEl.appendChild(h("span", { text: st.words + " mot" + (st.words > 1 ? "s" : "") })); statsEl.appendChild(h("span", { class: "wd-opt", text: " · lecture ≈ " + st.minutes + " min" })); }
        });
        ed.setHTML(startHtml);
        dirty = false; saveBtn.disabled = true; saveState.textContent = pg.custom ? "" : "Texte d'origine : enregistrez pour le modifier";
        title.addEventListener("input", mark); desc.addEventListener("input", mark);
        function save() {
          saveBtn.disabled = true; saveState.textContent = "Enregistrement…";
          api("PUT", "pages/" + encodeURIComponent(slug) + q, { title: title.value, description: desc.value, content: ed.getHTML() }).then(function (r) {
            dirty = false; pg = r.page; badge.textContent = (lang === "en" ? "English · " : "Français · ") + "Modifiée";
            saveState.textContent = "Enregistré à " + new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
            toast(S.meta && S.meta.siteRebuild ? "Page enregistrée. Le site se met à jour (1 à 2 minutes)." : "Page enregistrée. Mise à jour automatique du site non configurée.");
            resetBtn.hidden = false;
          }).catch(function (x) { saveBtn.disabled = false; saveState.textContent = "Échec de l'enregistrement"; toast(x.message, true); });
        }
        function reset() {
          confirmBox("La page retrouvera son texte d'origine ; votre version modifiée sera supprimée.", { title: "Rétablir le texte d'origine ?", confirm: "Rétablir", danger: true }).then(function (ok) {
            if (!ok) return;
            api("DELETE", "pages/" + encodeURIComponent(slug) + q).then(function () { dirty = false; toast("Texte d'origine rétabli."); location.hash = "#/pages"; }).catch(function (x) { toast(x.message, true); });
          });
        }
        function onKey(e) { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); if (!saveBtn.disabled) save(); } }
        function beforeUnload(e) { if (dirty) { e.preventDefault(); e.returnValue = ""; } }
        document.addEventListener("keydown", onKey); window.addEventListener("beforeunload", beforeUnload);
        guard = function () { return !dirty || window.confirm("Des modifications ne sont pas enregistrées. Quitter cette page quand même ?"); };
        cleanup = function () { document.removeEventListener("keydown", onKey); window.removeEventListener("beforeunload", beforeUnload); if (ed) ed.destroy(); };
      });
    });
  }

  /* ───────── Réglages du site (administrateur) ───────── */
  function renderSettings(view) {
    var SOC = [["twitter", "X (Twitter)"], ["facebook", "Facebook"], ["linkedin", "LinkedIn"], ["youtube", "YouTube"], ["instagram", "Instagram"]];
    var LEG = [["publisherName", "Nom de l'éditeur (par défaut : HNet Media)"], ["publisherAddress", "Adresse de l'éditeur"], ["director", "Directeur de la publication"], ["registration", "Numéro d'immatriculation de l'entreprise"], ["hostName", "Nom de l'hébergeur"], ["hostAddress", "Adresse de l'hébergeur"]];
    return ensureMeta().then(function () { return api("GET", "settings"); }).then(function (r) {
      var cur = r.settings, F = {};
      var err = h("div", { class: "hn-alert", hidden: true, role: "alert" });
      function field(key, label, val, o) {
        o = o || {};
        var el = o.area ? h("textarea", { id: "s-" + key, rows: o.rows || 3, maxlength: o.max }) : h("input", { id: "s-" + key, type: o.type || "text", maxlength: o.max, autocomplete: "off" });
        el.value = val || ""; F[key] = el;
        return [h("label", { for: "s-" + key, text: label }), el, o.hint ? h("p", { class: "hn-hint", text: o.hint }) : null];
      }
      function card(title, hint, rows) {
        var c = h("div", { class: "hn-card" }, h("h2", { text: title }));
        if (hint) c.appendChild(h("p", { class: "hn-hint", style: "margin:0 0 6px", text: hint }));
        rows.forEach(function (x) { x.forEach(function (n) { if (n) c.appendChild(n); }); });
        return c;
      }
      var form = h("form", { class: "hn-form", novalidate: true, style: "max-width:720px" },
        card("Le site", "Nom, slogan et description utilisés partout (en-têtes, partage, moteurs de recherche).", [
          field("siteName", "Nom du site", cur.siteName, { max: 80 }), field("tagline", "Slogan", cur.tagline, { max: 120 }),
          field("description", "Description du site", cur.description, { area: true, max: 300 })]),
        card("Pied de page", "Texte affiché sous le logo en bas de chaque page. Laissez vide pour garder le texte d'origine.", [
          field("footerText", "Texte du pied de page", cur.footerText, { area: true, max: 300 })]),
        card("Version anglaise du site", "Textes de la version anglaise (/en). Laissez vide pour utiliser la traduction d'origine fournie avec le site.", [
          field("taglineEn", "Slogan (anglais)", cur.taglineEn, { max: 120 }), field("descriptionEn", "Description du site (anglais)", cur.descriptionEn, { area: true, max: 300 }),
          field("footerTextEn", "Texte du pied de page (anglais)", cur.footerTextEn, { area: true, max: 300 })]),
        card("Réseaux sociaux", "Seuls les réseaux renseignés apparaissent dans le pied de page. Laissez vide pour ne rien afficher.",
          SOC.map(function (c) { return field("soc-" + c[0], c[1] + " (https://…)", cur.social[c[0]], { type: "url", max: 300 }); })),
        card("Mentions légales", "Informations juridiques réelles de l'éditeur et de l'hébergeur. Tant qu'elles manquent, la page publique affiche un avis « incomplet ».",
          LEG.map(function (c) { return field("leg-" + c[0], c[1], cur.legal[c[0]], { max: /Address$/.test(c[0]) ? 300 : 200 }); })),
        card("Commentaires", "Les lecteurs peuvent commenter les articles ; chaque commentaire est publié après votre validation (onglet Commentaires).", [
          [h("label", { for: "s-comments", style: "display:flex;gap:8px;align-items:center" }, (F.comments = h("input", { id: "s-comments", type: "checkbox", checked: cur.commentsEnabled !== false })), "Commentaires ouverts sur le site")]]),
        card("Formulaire de contact", null, [field("cats", "Types de demande (un par ligne)", (cur.contactCategories || []).join("\n"), { area: true, rows: 6, max: 600, hint: "De 1 à 12 types. Le visiteur choisit l'un d'eux dans le formulaire." })]),
        err,
        h("div", { class: "hn-actions" }, h("button", { type: "submit", class: "hn-btn hn-btn-primary", text: "Enregistrer les réglages" })));
      form.addEventListener("submit", function (e) {
        e.preventDefault(); err.hidden = true;
        var social = {}, legal = {};
        SOC.forEach(function (c) { social[c[0]] = F["soc-" + c[0]].value.trim(); });
        LEG.forEach(function (c) { legal[c[0]] = F["leg-" + c[0]].value.trim(); });
        api("PUT", "settings", { siteName: F.siteName.value, tagline: F.tagline.value, description: F.description.value, footerText: F.footerText.value, taglineEn: F.taglineEn.value, descriptionEn: F.descriptionEn.value, footerTextEn: F.footerTextEn.value, social: social, legal: legal, contactCategories: F.cats.value.split("\n"), commentsEnabled: F.comments.checked })
          .then(function () { toast("Réglages enregistrés."); })
          .catch(function (x) { err.textContent = x.message; err.hidden = false; });
      });
      clear(view);
      view.appendChild(heading("Réglages du site", "Réservé aux administrateurs. Les changements mettent le site à jour" + (S.meta.siteRebuild ? " automatiquement (1 à 2 minutes)." : " au prochain déploiement (mise à jour automatique non configurée).")));
      view.appendChild(form);
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
    .then(function (r) { S.user = r.user; S.csrf = r.csrfToken; S.perms = new Set(r.permissions); registerDevice(); start(); })
    .catch(function (x) {
      if (x.status === 401) { if (x.data && x.data.needsSetup) renderSetup(); else renderLogin(); return; }
      clear(app);
      app.appendChild(h("div", { class: "hn-auth" }, h("div", { class: "hn-alert", role: "alert", text: x.message || "Service indisponible. Réessayez dans quelques instants." })));
    });
})();
