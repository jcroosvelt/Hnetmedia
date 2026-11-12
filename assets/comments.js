/* ══════════════════════════════════════════════
   HNet Media — comments.js
   Commentaires d'un article : liste (approuvés seulement) + formulaire.
   Tout est inséré avec textContent (jamais innerHTML). Un commentaire envoyé reste
   « en attente » jusqu'à validation par la rédaction : le texte affiché le dit honnêtement.
   ══════════════════════════════════════════════ */
(function () {
  "use strict";
  var root = document.getElementById("comments");
  if (!root) return;
  var slug = root.getAttribute("data-article");
  var EN = document.documentElement.lang === "en";
  var list = document.getElementById("commentsList");
  var form = document.getElementById("commentForm");
  var msg = document.getElementById("commentMsg");
  var replyBar = document.getElementById("commentReplying");
  var openedAt = Date.now();
  var parentId = "";
  var T = EN ? {
    empty: "No comments yet. Be the first to react.", load: "Could not load the comments.", reply: "Reply", staff: "Newsroom",
    replyTo: "Replying to {n}", cancel: "Cancel", sending: "Sending…", send: "Send my comment",
    ok: "Thank you! Your comment has been received. It will be published after review by the newsroom.",
    closed: "Comments are closed for now.", invalid: "Please enter your name (2 characters minimum) and a comment (3 characters minimum).",
    badMail: "That email address does not look valid.", bad: "Your comment could not be sent. Please check the fields and try again.",
    many: "You have sent several comments recently. Please try again later.", dup: "You have already sent this comment.",
    links: "Your comment contains too many links (2 maximum).", net: "Sending failed (connection). Please try again."
  } : {
    empty: "Aucun commentaire pour l'instant. Soyez le premier à réagir.", load: "Impossible de charger les commentaires.", reply: "Répondre", staff: "Rédaction",
    replyTo: "Réponse à {n}", cancel: "Annuler", sending: "Envoi en cours…", send: "Envoyer mon commentaire",
    ok: "", closed: "Les commentaires sont fermés pour le moment.", invalid: "Merci de renseigner votre nom (2 caractères minimum) et un commentaire (3 caractères minimum).",
    badMail: "Cette adresse e-mail ne semble pas valide.", bad: "", many: "", dup: "", links: "", net: "L'envoi a échoué (connexion). Merci de réessayer."
  };

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function fmtDate(iso) { return new Date(iso).toLocaleDateString(EN ? "en-GB" : "fr-FR", { day: "numeric", month: "long", year: "numeric" }); }
  function show(text, isError) {
    msg.hidden = false; msg.textContent = text;
    msg.style.background = isError ? "#FEE2E2" : "#FFFFFF";
    msg.style.borderColor = isError ? "#DC2626" : "#059669";
    msg.style.color = isError ? "#7A1212" : "#111827";
  }
  function item(c, canReply) {
    var box = el("div", "cm-item");
    var head = el("div", "cm-head");
    head.appendChild(el("span", "cm-name", c.name));
    if (c.staff) head.appendChild(el("span", "cm-staff", T.staff));
    head.appendChild(el("span", "", fmtDate(c.createdAt)));
    box.appendChild(head);
    box.appendChild(el("p", "cm-body", c.body));
    if (canReply) {
      var b = el("button", "cm-reply-btn", T.reply); b.type = "button";
      b.addEventListener("click", function () { setParent(c); });
      box.appendChild(b);
    }
    if (c.replies && c.replies.length) {
      var wrap = el("div", "cm-replies");
      c.replies.forEach(function (r) { wrap.appendChild(item(r, false)); });
      box.appendChild(wrap);
    }
    return box;
  }
  function setParent(c) {
    parentId = c ? c.id : "";
    replyBar.hidden = !c;
    replyBar.textContent = "";
    if (c) {
      replyBar.appendChild(el("span", "", T.replyTo.replace("{n}", c.name)));
      var x = el("button", "", T.cancel); x.type = "button"; x.addEventListener("click", function () { setParent(null); });
      replyBar.appendChild(x);
      form.scrollIntoView({ behavior: "smooth", block: "center" });
      form.elements.body.focus();
    }
  }
  function setCount(n) {
    var els = document.querySelectorAll("[data-cm-count]");
    for (var i = 0; i < els.length; i++) { els[i].textContent = n ? String(n) : ""; els[i].hidden = !n; }
  }
  function render(data) {
    setCount(data.enabled ? data.total : 0);
    list.textContent = "";
    if (!data.enabled) { form.hidden = true; list.appendChild(el("p", "cm-empty", T.closed)); return; }
    if (!data.items.length) { list.appendChild(el("p", "cm-empty", T.empty)); return; }
    data.items.forEach(function (c) { list.appendChild(item(c, true)); });
  }
  function load() {
    fetch("/api/comments?article=" + encodeURIComponent(slug), { headers: { Accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("http"); return r.json(); })
      .then(render)
      .catch(function () { list.textContent = ""; list.appendChild(el("p", "cm-empty", T.load)); });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var name = form.elements.name.value.trim(), email = form.elements.email.value.trim(), body = form.elements.body.value.trim();
    if (name.length < 2 || body.length < 3) return show(T.invalid, true);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return show(T.badMail, true);
    var btn = form.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = T.sending;
    fetch("/api/comments", {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ article: slug, name: name, email: email, body: body, parentId: parentId, lang: EN ? "en" : "fr", hp: form.elements.hp.value, ts: openedAt })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, d: d }; });
    }).then(function (x) {
      if (x.status === 201) {
        show(EN ? T.ok : (x.d.message || ""), false);
        form.elements.body.value = ""; setParent(null); openedAt = Date.now();
      } else if (EN) {
        show(x.status === 429 ? T.many : x.status === 409 ? T.dup : x.status === 503 ? T.closed : (x.d.error || "").indexOf("liens") > -1 ? T.links : T.bad, true);
      } else {
        show(x.d.error || "L'envoi a échoué. Merci de réessayer.", true);
      }
    }).catch(function () { show(T.net, true); })
      .then(function () { btn.disabled = false; btn.textContent = T.send; });
  });

  load();
})();
