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
      showMsg("Merci de renseigner votre nom, un email valide et un message.", true);
      return;
    }
    if (!data.get("category")) {
      showMsg("Merci de choisir le type de demande.", true);
      return;
    }
    if (message.length < 10) {
      showMsg("Votre message est trop court (10 caractères minimum).", true);
      return;
    }

    var submitBtn = form.querySelector("button[type=submit]");
    var originalLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "Envoi en cours…";

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
            showMsg(body.message || "Votre message a bien été reçu.", false);
            form.reset();
            openedAt = Date.now();
          } else {
            showMsg((body && body.error) || "L'envoi a échoué. Merci de réessayer un peu plus tard.", true);
            openedAt = Date.now() - 4000; // un nouvel essai immédiat n'est pas pris pour un robot
          }
        });
      })
      .catch(function () {
        showMsg("L'envoi a échoué (connexion). Merci de réessayer.", true);
      })
      .finally(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
      });
  });
})();
