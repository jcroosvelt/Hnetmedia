"use strict";
/**
 * Nettoyage du HTML des articles (liste blanche) : empêche l'injection de
 * scripts par un compte rédactionnel compromis ou malveillant.
 */
const sanitizeHtml = require("sanitize-html");

const isAllowedImage = (src) => /^https:\/\/[^\s"'<>]+$/i.test(String(src || "")) || /^\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(src || ""));

const OPTIONS = {
  allowedTags: ["p", "br", "h2", "h3", "h4", "strong", "b", "em", "i", "u", "s", "sup", "sub",
    "ul", "ol", "li", "blockquote", "q", "cite", "a", "figure", "figcaption", "img", "hr",
    "table", "thead", "tbody", "tr", "th", "td", "caption", "code", "pre", "span"],
  allowedAttributes: {
    p: ["style"], h2: ["style"], h3: ["style"], h4: ["style"],
    a: ["href", "title", "rel", "target"],
    img: ["src", "alt", "title", "width", "height", "loading"],
    th: ["scope", "colspan", "rowspan"], td: ["colspan", "rowspan"],
    blockquote: ["cite"], q: ["cite"],
  },
  // Seul l'alignement du texte est toléré dans « style ».
  allowedStyles: { "*": { "text-align": [/^(left|right|center|justify)$/] } },
  allowedSchemes: ["https", "http", "mailto"],
  allowedSchemesByTag: { img: ["https"] },
  allowProtocolRelative: false,
  // Images : https, ou une image téléversée sur ce site (/media/<id>) — rien d'autre (pas de chemin libre).
  exclusiveFilter: (frame) => frame.tag === "img" && !isAllowedImage(frame.attribs && frame.attribs.src),
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

module.exports = { cleanHtml, plainText, isAllowedImage };
