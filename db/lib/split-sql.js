"use strict";
/**
 * Découpe un fichier SQL en instructions, en respectant les chaînes '...',
 * les identifiants "...", les commentaires -- et /* *\/, et les blocs $tag$...$tag$.
 * Nécessaire car le pilote HTTP de Neon exécute une instruction par requête.
 */
module.exports = function splitSql(src) {
  const out = [];
  let cur = "", i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === "-" && n === "-") { const e = src.indexOf("\n", i); i = e === -1 ? src.length : e + 1; cur += "\n"; continue; }
    if (c === "/" && n === "*") { const e = src.indexOf("*/", i + 2); i = e === -1 ? src.length : e + 2; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < src.length) { if (src[j] === c) { if (src[j + 1] === c) { j += 2; continue; } break; } j++; }
      cur += src.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === "$") {
      const m = /^\$[A-Za-z_]*\$/.exec(src.slice(i));
      if (m) { const e = src.indexOf(m[0], i + m[0].length); const end = e === -1 ? src.length : e + m[0].length; cur += src.slice(i, end); i = end; continue; }
    }
    if (c === ";") { if (cur.trim()) out.push(cur.trim()); cur = ""; i++; continue; }
    cur += c; i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
};
