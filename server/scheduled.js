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
const push = require("./push");
const commentsSvc = require("./comments");

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

/**
 * Rappels push : messages de contact « nouveau » non traités. Chaque message est « réclamé » de façon atomique
 * (colonne push_reminded_at) : premier rappel après 30 min, puis au plus toutes les 2 h, 3 rappels maximum.
 * Sans configuration push, on ne touche à rien (les compteurs ne sont pas consommés).
 */
async function remindPending() {
  if (!push.isConfigured()) return 0;
  const rows = await getDb().query(`
    UPDATE contact_messages SET push_reminded_at = now(), push_reminders = push_reminders + 1
    WHERE status = 'nouveau' AND push_reminders < 3 AND (
      (push_reminded_at IS NULL AND created_at < now() - interval '30 minutes')
      OR push_reminded_at < now() - interval '2 hours')
    RETURNING id`);
  if (!rows.length) return 0;
  await push.notify({
    permission: "contact.read", channel: "messages", title: "Rappel : messages à traiter",
    body: rows.length === 1 ? "1 message de contact attend une réponse." : `${rows.length} messages de contact attendent une réponse.`,
    url: "/admin#/messages",
  });
  return rows.length;
}

/** Rappel unique pour les articles soumis depuis plus de 2 h et toujours en brouillon. */
async function remindReviews() {
  if (!push.isConfigured()) return 0;
  const rows = await getDb().query(`
    UPDATE articles SET review_reminded_at = now()
    WHERE status = 'brouillon' AND review_requested_at IS NOT NULL AND review_reminded_at IS NULL
      AND review_requested_at < now() - interval '2 hours'
    RETURNING id`);
  if (!rows.length) return 0;
  await push.notify({
    permission: "article.publish", channel: "publication", title: "Rappel : articles à approuver",
    body: rows.length === 1 ? "1 article attend votre approbation." : `${rows.length} articles attendent votre approbation.`,
    url: "/admin#/articles",
  });
  return rows.length;
}

/** Article programmé dont l'heure est passée mais incomplet : prévenu UNE fois (review_reminded_at). */
async function warnBlocked() {
  if (!push.isConfigured()) return 0;
  const rows = await getDb().query(`
    UPDATE articles SET review_reminded_at = now()
    WHERE status = 'programme' AND published_at <= now() AND review_reminded_at IS NULL RETURNING id, slug`);
  for (const r of rows) {
    await push.notify({ permission: "article.publish", channel: "publication", title: "Article programmé bloqué", body: `« ${r.slug} » est incomplet (rubrique, signature ou texte) et n'a pas pu être publié.`, url: `/admin#/articles/${r.id}` });
  }
  return rows.length;
}

async function run() {
  const r = await promoteDue();
  await housekeeping();
  let rebuild = false;
  if (r.promoted.length) {
    rebuild = await triggerRebuild(`publication programmée : ${r.promoted.join(", ")}`);
    const titles = await getDb().query(
      `SELECT a.id, a.slug, t.title FROM articles a JOIN article_translations t ON t.article_id = a.id AND t.lang = a.original_lang
       WHERE a.slug = ANY($1::text[])`, [r.promoted]);
    for (const x of titles) await push.notify({ permission: "article.edit_any", channel: "publication", title: "Article publié", body: x.title, url: `/admin#/articles/${x.id}` });
  }
  const reminded = (await remindPending()) + (await remindReviews()) + (await warnBlocked()) + (await commentsSvc.remindPending());
  return { ...r, rebuild, reminded };
}

module.exports = { run, promoteDue, remindPending, remindReviews, warnBlocked };
