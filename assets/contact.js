/* ══════════════════════════════════════════════
   HNet Media — contact.js
   Formulaire de contact : envoi réel vers /api/contact.
   Le message est enregistré côté serveur (consultable dans
   l'espace rédaction). Aucune fausse confirmation : le texte
   de succès ou d'erreur affiché est celui renvoyé par le serveur.
   ══════════════════════════════════════════════ */
(function () {
  "use strict";

  var form = document.getElementById("contactForm");
  if (!form) return;
  var msgBox = document.getElementById("contactMsg");
  var openedAt = Date.now(); // anti-robots : un humain met plus de quelques secondes à écrire
  var EN = document.documentElement.lang === "en";
  // Textes de la page : français (messages du serveur affichés tels quels) ou anglais (messages propres au statut).
  var TXT = EN ? {
    invalid: "Please enter your name, a valid email address and a message.",
    category: "Please choose the type of request.",
    short: "Your message is too short (10 characters minimum).",
    sending: "Sending…",
    ok: "Your message has been received. The newsroom will reply by email.",
    fail: "Sending failed. Please try again a little later.",
    bad: "Your message could not be sent. Please check the fields, wait a few seconds and try again.",
    many: "You have sent several messages recently. Please try again in an hour.",
    net: "Sending failed (connection). Please try again."
  } : {
    invalid: "Merci de renseigner votre nom, un email valide et un message.",
    category: "Merci de choisir le type de demande.",
    short: "Votre message est trop court (10 caractères minimum).",
    sending: "Envoi en cours…",
    ok: "Votre message a bien été reçu.",
    fail: "L'envoi a échoué. Merci de réessayer un peu plus tard.",
    net: "L'envoi a échoué (connexion). Merci de réessayer."
  };

  function showMsg(text, isError) {
    msgBox.hidden = false;
    msgBox.textContent = text;
    msgBox.style.background = isError ? "#FEE2E2" : "#FFFFFF";
    msgBox.style.borderColor = isError ? "#DC2626" : "#059669";
    msgBox.style.color = isError ? "#7A1212" : "#111827";
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var data = new FormData(form);
    var email = String(data.get("email") || "").trim();
    var name = String(data.get("name") || "").trim();
    var message = String(data.get("message") || "").trim();

    if (!name || !message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showMsg(TXT.invalid, true);
      return;
    }
    if (!data.get("category")) {
      showMsg(TXT.category, true);
      return;
    }
    if (message.length < 10) {
      showMsg(TXT.short, true);
      return;
    }

    var submitBtn = form.querySelector("button[type=submit]");
    var originalLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = TXT.sending;

    fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        name: name,
        email: email,
        category: String(data.get("category") || ""),
        subject: String(data.get("subject") || "").trim(),
        message: message,
        hp: String(data.get("hp") || ""),
        ts: openedAt
      })
    })
      .then(function (res) {
        return res.json().catch(function () { return null; }).then(function (body) {
          if (res.ok && body && body.ok) {
            showMsg(EN ? TXT.ok : (body.message || TXT.ok), false);
            form.reset();
            openedAt = Date.now();
          } else {
            showMsg(EN ? (res.status === 429 ? TXT.many : res.status === 400 ? TXT.bad : TXT.fail) : ((body && body.error) || TXT.fail), true);
            openedAt = Date.now() - 4000; // un nouvel essai immédiat n'est pas pris pour un robot
          }
        });
      })
      .catch(function () {
        showMsg(TXT.net, true);
      })
      .finally(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
      });
  });
})();
