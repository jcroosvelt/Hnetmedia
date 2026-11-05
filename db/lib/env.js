"use strict";
/** Charge .env.local (si présent) sans dépendance et sans jamais afficher les valeurs. */
const fs = require("fs");
const path = require("path");
module.exports = function loadEnv() {
  const p = path.join(__dirname, "..", "..", ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
};
