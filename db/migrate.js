#!/usr/bin/env node
"use strict";
/**
 * Applique, dans l'ordre, les migrations de db/migrations non encore appliquées.
 * Chaque migration tourne dans une transaction et est enregistrée dans
 * schema_migrations avec son empreinte SHA-256 (une migration déjà appliquée
 * puis modifiée est signalée et bloque : créer une nouvelle migration).
 *
 *   node db/migrate.js            applique
 *   node db/migrate.js --status   affiche l'état sans rien modifier
 *
 * DATABASE_URL doit pointer vers la branche Neon `dev` (jamais main en local).
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
require("../server/env")();
const splitSql = require("./lib/split-sql");

const DIR = path.join(__dirname, "migrations");

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL absente (voir .env.example).");
    process.exit(1);
  }
  const db = require("../server/db").getDb();
  const statusOnly = process.argv.includes("--status");

  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied = new Map((await db.query("SELECT version, checksum FROM schema_migrations")).map((r) => [r.version, r.checksum]));

  const files = fs.readdirSync(DIR).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  for (const f of files) {
    const body = fs.readFileSync(path.join(DIR, f), "utf8");
    const checksum = crypto.createHash("sha256").update(body).digest("hex");
    if (applied.has(f)) {
      if (applied.get(f) !== checksum) {
        console.error(`❌ ${f} a été modifiée après application. Créez une nouvelle migration.`);
        process.exit(1);
      }
      console.log(`✔ ${f} (déjà appliquée)`);
      continue;
    }
    if (statusOnly) { console.log(`… ${f} (en attente)`); continue; }
    const statements = splitSql(body).map((text) => ({ text }));
    statements.push({ text: "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)", params: [f, checksum] });
    await db.transaction(statements);
    console.log(`✅ ${f} appliquée`);
  }
}

main()
  .then(() => require("../server/db").getDb().end())
  .catch((e) => { console.error("❌ Échec :", e.message); process.exit(1); });
