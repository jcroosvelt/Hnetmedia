/* ══════════════════════════════════════════════
   HNet Media — newsletter.js
   ⚠️ PHASE 1 (sans base de données / backend) :
   ce script valide l'email et prépare l'inscription,
   mais a besoin d'un NEWSLETTER_ENDPOINT (Brevo,
   Mailchimp, Newsletter API interne...) pour enregistrer
   réellement l'abonné. Aucune fausse confirmation
   n'est affichée tant que rien n'est branché.
   ══════════════════════════════════════════════ */
(function () {
  "use strict";

  // 👉 À CONFIGURER EN PHASE 2 : endpoint de votre outil newsletter.
  var NEWSLETTER_ENDPOINT = "";

  var form = document.getElementById("newsletterForm");
  if (!form) return;
  var emailInput = document.getElementById("nlEmail");
  var msg = document.getElementById("nlMsg");

  function showMsg(text, ok) {
    msg.textContent = text;
    msg.style.color = ok ? "#8FD8AA" : "#FFD79A";
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var email = emailInput.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showMsg("Merci de saisir une adresse email valide.", false);
      return;
    }

    if (!NEWSLETTER_ENDPOINT) {
      console.info("[HNet Media] Inscription newsletter prête pour :", email, "— configurez NEWSLETTER_ENDPOINT dans assets/newsletter.js pour l'activer réellement.");
      showMsg("Formulaire prêt, mais aucun service newsletter n'est encore connecté (Phase 1 — sans backend). Votre email n'a pas été enregistré.", false);
      return;
    }

    var submitBtn = form.querySelector(".nl-submit");
    var originalLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "…";

    fetch(NEWSLETTER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, consent: true, source: "site-hnetmedia" })
    })
      .then(function (res) {
        if (res.ok) { showMsg("Merci ! Vérifiez votre boîte mail pour confirmer votre inscription.", true); form.reset(); }
        else { showMsg("L'inscription a échoué. Merci de réessayer.", false); }
      })
      .catch(function () { showMsg("L'inscription a échoué (connexion). Merci de réessayer.", false); })
      .finally(function () { submitBtn.disabled = false; submitBtn.textContent = originalLabel; });
  });
})();
