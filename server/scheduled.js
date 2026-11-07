"use strict";
/**
 * Publication programmée : fait passer à « publié » les articles « programmés » dont l'heure est arrivée,
 * puis demande une reconstruction du site. Appelé périodiquement (voir api/scheduled.js).
 *
 * Un article n'est promu que s'il est toujours publiable (rubrique, signature, titre et texte non vides) :
 * sinon il reste « programmé » et il est signalé, jamais publié à moitié.
 */
const { getDb } = require("./db");
const { triggerRebuild } = require("./deploy-hook");

async function promoteDue() {
  const db = getDb();
  const promoted = await db.query(`
    WITH due AS (
      UPDATE articles a SET status = 'publie', updated_at = now()
      WHERE a.status = 'programme' AND a.published_at <= now()
        AND a.category_slug IS NOT NULL
        AND (a.author_id IS NOT NULL OR btrim(COALESCE(a.author_name, '')) <> '')
        AND EXISTS (SELECT 1 FROM article_translations t
                    WHERE t.article_id = a.id AND t.lang = a.original_lang AND btrim(t.title) <> '' AND btrim(t.content) <> '')
      RETURNING a.id, a.slug
    ), journal AS (
      INSERT INTO audit_log (action, entity, entity_id, details)
      SELECT 'article.statut.publie_auto', 'article', id, jsonb_build_object('slug', slug) FROM due
    )
    SELECT id, slug FROM due`);
  const blocked = await db.query("SELECT slug FROM articles WHERE status = 'programme' AND published_at <= now()");
  return { promoted: promoted.map((r) => r.slug), blocked: blocked.map((r) => r.slug) };
}

/** Ménage de données techniques expirées (sessions, compteurs de limitation) et trace de la dernière exécution. */
async function housekeeping() {
  const db = getDb();
  await db.query("DELETE FROM sessions WHERE expires_at < now() - interval '7 days'");
  await db.query("DELETE FROM rate_limits WHERE window_start < now() - interval '2 days'");
  await db.query(`INSERT INTO site_settings (key, value) VALUES ('scheduledLastRun', to_jsonb(now())) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
}

async function run() {
  const r = await promoteDue();
  await housekeeping();
  let rebuild = false;
  if (r.promoted.length) rebuild = await triggerRebuild(`publication programmée : ${r.promoted.join(", ")}`);
  return { ...r, rebuild };
}

module.exports = { run, promoteDue };
