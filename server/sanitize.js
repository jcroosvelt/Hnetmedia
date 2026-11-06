"use strict";
/**
 * Nettoyage du HTML des articles (liste blanche) : empêche l'injection de
 * scripts par un compte rédactionnel compromis ou malveillant.
 */
const sanitizeHtml = require("sanitize-html");

const OPTIONS = {
  allowedTags: ["p", "br", "h2", "h3", "h4", "strong", "b", "em", "i", "u", "s", "sup", "sub",
    "ul", "ol", "li", "blockquote", "q", "cite", "a", "figure", "figcaption", "img", "hr",
    "table", "thead", "tbody", "tr", "th", "td", "caption", "code", "pre", "span"],
  allowedAttributes: {
    a: ["href", "title", "rel", "target"],
    img: ["src", "alt", "title", "width", "height", "loading"],
    th: ["scope", "colspan", "rowspan"], td: ["colspan", "rowspan"],
    blockquote: ["cite"], q: ["cite"],
  },
  allowedSchemes: ["https", "http", "mailto"],
  allowedSchemesByTag: { img: ["https"] },
  allowProtocolRelative: false,
  transformTags: {
    a: (tagName, attribs) => {
      const external = /^https?:\/\//i.test(attribs.href || "");
      return { tagName, attribs: external ? { ...attribs, rel: "noopener noreferrer nofollow", target: "_blank" } : attribs };
    },
  },
};

const cleanHtml = (html) => sanitizeHtml(String(html || ""), OPTIONS);
// Texte brut : balises retirées, puis entités décodées. On stocke « Éducation & santé »,
// jamais « Éducation &amp; santé » (sinon l'éditeur l'affiche tel quel et chaque
// enregistrement l'échappe un peu plus). L'échappement se fait à l'affichage.
const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decodeEntities = (s) => s.replace(/&(?:(amp|lt|gt|quot|apos)|#(\d{1,7})|#x([0-9a-f]{1,6}));/gi, (m, name, dec, hex) => {
  if (name) return NAMED[name.toLowerCase()];
  const cp = dec ? parseInt(dec, 10) : parseInt(hex, 16);
  return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : m;
});
const plainText = (s) => decodeEntities(sanitizeHtml(String(s || ""), { allowedTags: [], allowedAttributes: {} })).trim();

module.exports = { cleanHtml, plainText };
