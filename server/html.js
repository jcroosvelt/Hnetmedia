"use strict";
/**
 * JSON placé DANS une balise <script> (ex. JSON-LD) : « < > & » sont échappés pour qu'un titre,
 * un chapeau ou un nom ne puisse jamais fermer la balise (« </script> ») ni injecter du code.
 * Le JSON reste valide et se relit à l'identique.
 */
function jsonForHtml(obj) {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
module.exports = { jsonForHtml };
