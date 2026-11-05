/* ══════════════════════════════════════════════
   HNet Media — contact.js
   Formulaire de contact réel côté client.
   ⚠️ PHASE 1 (sans base de données / backend) :
   ce script valide et prépare l'envoi, mais a besoin
   d'un CONTACT_ENDPOINT (Formspree, Netlify Forms,
   Brevo, ou votre propre API) pour envoyer réellement
   le message. Tant qu'aucun endpoint n'est configuré,
   le formulaire l'indique honnêtement plutôt que
   d'afficher une fausse confirmation.
   ══════════════════════════════════════════════ */
(function () {
  "use strict";

  // 👉 À CONFIGURER EN PHASE 2 : URL de votre service d'envoi de formulaire.
  // Exemples compatibles : "https://formspree.io/f/VOTRE_ID",
  // un endpoint Netlify Forms, ou votre propre API.
  var CONTACT_ENDPOINT = "";

  var form = document.getElementById("contactForm");
  if (!form) return;
  var msgBox = document.getElementById("contactMsg");

  function showMsg(text, isError) {
    msgBox.hidden = false;
    msgBox.textContent = text;
    msgBox.style.background = isError ? "#FEE2E2" : "#FEF3C7";
    msgBox.style.borderColor = isError ? "#DC2626" : "#F59E0B";
    msgBox.style.color = isError ? "#7A1212" : "#7A5A00";
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var data = new FormData(form);
    var email = String(data.get("email") || "");
    var name = String(data.get("name") || "").trim();
    var message = String(data.get("message") || "").trim();

    if (!name || !message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showMsg("Merci de renseigner votre nom, un email valide et un message.", true);
      return;
    }

    if (!CONTACT_ENDPOINT) {
      // Mode démonstration honnête : pas de backend branché.
      console.info("[HNet Media] Formulaire de contact prêt. Configurez CONTACT_ENDPOINT dans assets/contact.js pour activer l'envoi réel.", Object.fromEntries(data));
      showMsg("Ce formulaire est prêt mais aucun service d'envoi n'est encore configuré (Phase 1 — sans backend). Votre message n'a pas été transmis. Contactez-nous directement à redaction@hnetmedia.com en attendant.", false);
      return;
    }

    var submitBtn = form.querySelector("button[type=submit]");
    var originalLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "Envoi en cours…";

    fetch(CONTACT_ENDPOINT, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: data
    })
      .then(function (res) {
        if (res.ok) {
          showMsg("Merci, votre message a bien été envoyé. La rédaction vous répondra rapidement.", false);
          form.reset();
        } else {
          showMsg("L'envoi a échoué. Merci de réessayer ou de nous écrire directement à redaction@hnetmedia.com.", true);
        }
      })
      .catch(function () {
        showMsg("L'envoi a échoué (connexion). Merci de réessayer ou de nous écrire directement à redaction@hnetmedia.com.", true);
      })
      .finally(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
      });
  });
})();
