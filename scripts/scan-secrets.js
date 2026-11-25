#!/usr/bin/env node
"use strict";
/**
 * Détecteur de secrets sans dépendance (clés API, chaînes de connexion avec mot de passe, clés privées, jetons).
 *   node scripts/scan-secrets.js            fichiers suivis par git
 *   node scripts/scan-secrets.js --staged   fichiers prêts à être commités (pre-commit)
 *   node scripts/scan-secrets.js --history  fichiers suivis + TOUT l'historique git (lignes ajoutées)
 * Code de sortie 1 si un secret probable est trouvé. Les valeurs sont toujours masquées dans l'affichage.
 */
const { execFileSync } = require("child_process");
const fs = require("fs");

const PATTERNS = {
  "clé privée (PEM)": /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/,
  "chaîne de connexion avec mot de passe": /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:@/'"]+:[^\s@/'"]{3,}@[^\s'"]+/,
  "clé Stripe": /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/,
  "clé Google (AIza)": /\bAIza[0-9A-Za-z_-]{35}\b/,
  "clé Resend": /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{10,}\b/,
  "jeton GitHub": /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/,
  "clé AWS": /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  "jeton Neon (napi_)": /\bnapi_[a-z0-9]{20,}\b/,
  "mot de passe Neon (npg_)": /\bnpg_[A-Za-z0-9]{8,}\b/,
  "JWT": /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
};
// Fichiers où une valeur factice est normale (tests, exemples) : on n'y cherche pas.
const SKIP = /^(test\/|\.env\.example$|package-lock\.json$|.*\.(png|jpg|jpeg|ico|webp|svg|woff2?)$)/;
// Clé Google d'un fichier google-services.json : identifiant public par conception (à RESTREINDRE côté Google Cloud).
const ALLOW = [/google-services\.json$/];

const mask = (s) => (s.length > 12 ? s.slice(0, 6) + "****" + s.slice(-3) : "****");
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
const mode = process.argv[2] || "";
const found = [];

function scanText(text, where) {
  for (const [name, rx] of Object.entries(PATTERNS)) {
    const m = rx.exec(text);
    if (m) found.push({ name, value: mask(m[0]), where });
  }
}

const files = (mode === "--staged" ? git("diff", "--cached", "--name-only", "--diff-filter=ACM") : git("ls-files")).split("\n").filter(Boolean);
for (const f of files) {
  if (SKIP.test(f) || ALLOW.some((a) => a.test(f))) continue;
  try { scanText(fs.readFileSync(f, "utf8"), f); } catch { /* binaire ou supprimé */ }
}
if (mode === "--history") {
  let commit = "";
  for (const line of git("log", "--all", "-p", "--no-color", "--format=@@@%h").split("\n")) {
    if (line.startsWith("@@@")) { commit = line.slice(3); continue; }
    if (line.startsWith("+") && !line.startsWith("+++")) scanText(line, "historique, commit " + commit);
  }
}

if (!found.length) { console.log("✔ Aucun secret détecté (" + files.length + " fichiers" + (mode === "--history" ? " + historique complet" : "") + ")."); process.exit(0); }
const seen = new Set();
for (const f of found) {
  const k = f.name + f.value + f.where;
  if (seen.has(k)) continue;
  seen.add(k);
  console.error(`✘ ${f.name} : ${f.value}  (${f.where})`);
}
console.error("\nSecret probable détecté : ne le commitez pas ; s'il est déjà publié, considérez-le comme compromis et révoquez-le.");
process.exit(1);
