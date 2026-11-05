"use strict";
/**
 * Accès base de données.
 *  - Production / Vercel : pilote HTTP Neon (@neondatabase/serverless).
 *  - Tests locaux : DB_DRIVER=pg → PostgreSQL local via `pg` (devDependency).
 * Toutes les requêtes sont paramétrées : query(text, [params]).
 * La chaîne DATABASE_URL n'est jamais journalisée.
 */
class ConfigError extends Error {}

let impl = null;

function getDb() {
  if (impl) return impl;
  const url = process.env.DATABASE_URL;
  if (!url) throw new ConfigError("DATABASE_URL non configurée");
  if (process.env.DB_DRIVER === "pg") {
    const { Pool } = require("pg");
    const pool = new Pool({ connectionString: url, max: 5 });
    impl = {
      query: async (text, params = []) => (await pool.query(text, params)).rows,
      transaction: async (queries) => {
        const c = await pool.connect();
        try {
          await c.query("BEGIN");
          const out = [];
          for (const q of queries) out.push((await c.query(q.text, q.params || [])).rows);
          await c.query("COMMIT");
          return out;
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        } finally {
          c.release();
        }
      },
      end: () => pool.end(),
    };
  } else {
    const { neon } = require("@neondatabase/serverless");
    const sql = neon(url);
    impl = {
      query: (text, params = []) => sql.query(text, params),
      transaction: (queries) => sql.transaction(queries.map((q) => sql.query(q.text, q.params || []))),
      end: async () => {},
    };
  }
  return impl;
}

module.exports = { getDb, ConfigError };
