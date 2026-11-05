"use strict";
/**
 * Anti-spam sans service tiers :
 *  1. champ piège invisible `hp` (doit rester vide) ;
 *  2. délai minimal entre l'affichage du formulaire (`ts`, horodatage ms
 *     posé par le JavaScript de la page) et l'envoi.
 * Une erreur explicite (pas de fausse confirmation) est renvoyée.
 */
const { HttpError } = require("./http");

function check(body, { minMs = 3000 } = {}) {
  if (body.hp !== undefined && String(body.hp).trim() !== "") {
    throw new HttpError(400, "Envoi refusé. Rechargez la page et réessayez.");
  }
  const ts = Number(body.ts);
  const age = Date.now() - ts;
  if (!Number.isFinite(ts) || age < minMs || age > 24 * 3600 * 1000) {
    throw new HttpError(400, "Envoi trop rapide ou formulaire expiré. Patientez quelques secondes puis réessayez.");
  }
}

module.exports = { check };
