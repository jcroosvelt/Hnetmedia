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
const plainText = (s) => sanitizeHtml(String(s || ""), { allowedTags: [], allowedAttributes: {} }).trim();

module.exports = { cleanHtml, plainText };
