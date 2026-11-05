"use strict";
const { HttpError } = require("./http");

// Supprime les caractères de contrôle (sauf saut de ligne / tabulation pour les textes longs).
const clean = (v, multiline = false) => String(v === undefined || v === null ? "" : v)
  .replace(multiline ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, "")
  .trim();

function str(body, field, { min = 0, max = 200, multiline = false, required = true, label = field } = {}) {
  const v = clean(body[field], multiline);
  if (!v) {
    if (required) throw new HttpError(400, `Le champ « ${label} » est obligatoire.`, { field });
    return null;
  }
  if (v.length < min) throw new HttpError(400, `Le champ « ${label} » est trop court (${min} caractères minimum).`, { field });
  if (v.length > max) throw new HttpError(400, `Le champ « ${label} » est trop long (${max} caractères maximum).`, { field });
  return v;
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
function email(body, field = "email", label = "E-mail") {
  const v = str(body, field, { max: 254, label });
  if (!EMAIL_RE.test(v) || v.split("@")[0].length > 64) throw new HttpError(400, "Adresse e-mail invalide.", { field });
  return v.toLowerCase();
}

function oneOf(body, field, allowed, { required = true, label = field } = {}) {
  const v = clean(body[field]);
  if (!v && !required) return null;
  if (!allowed.includes(v)) throw new HttpError(400, `Valeur invalide pour « ${label} ».`, { field });
  return v;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function slug(body, field = "slug") {
  const v = str(body, field, { max: 120, label: "Slug" });
  if (!SLUG_RE.test(v)) throw new HttpError(400, "Slug invalide (minuscules, chiffres et tirets).", { field });
  return v;
}

function dateTime(body, field, { required = false, label = field } = {}) {
  const v = clean(body[field]);
  if (!v) { if (required) throw new HttpError(400, `Le champ « ${label} » est obligatoire.`, { field }); return null; }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `Date invalide pour « ${label} ».`, { field });
  return d.toISOString();
}

function url(body, field, { required = false, label = field } = {}) {
  const v = str(body, field, { max: 2000, required, label });
  if (!v) return null;
  let u;
  try { u = new URL(v); } catch { throw new HttpError(400, `Lien invalide pour « ${label} ».`, { field }); }
  if (!["http:", "https:"].includes(u.protocol)) throw new HttpError(400, `Lien invalide pour « ${label} ».`, { field });
  return u.toString();
}

module.exports = { clean, str, email, oneOf, slug, dateTime, url, SLUG_RE };
