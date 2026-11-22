import knex from '../../../config/knex.config.js';

const SNAPSHOT_FIELDS = [
  'id',
  'region',
  knex.raw(`to_char(date, 'YYYY-MM-DD') as date`),
  'provider',
  'emergency',
  'sources_agree',
  'signature',
  'queues',
  'source_updated_at',
  'fetched_at',
];

const LOG_KEEP_DAYS = 14;

export default {
  async latestSnapshot(region, date, trx = knex) {
    return (
      (await trx('outage_snapshots')
        .select(SNAPSHOT_FIELDS)
        .where({ region, date })
        .orderBy('fetched_at', 'desc')
        .first()) ?? null
    );
  },

  async snapshotsForDate(region, date, trx = knex) {
    return trx('outage_snapshots')
      .select(SNAPSHOT_FIELDS)
      .where({ region, date })
      .orderBy('fetched_at', 'asc');
  },

  async insertSnapshot(row, trx = knex) {
    const [created] = await trx('outage_snapshots')
      .insert({ ...row, queues: JSON.stringify(row.queues) })
      .returning('id');
    return created?.id ?? created;
  },

  async markRegion(region, { ok, error = null }, trx = knex) {
    const now = trx.fn.now();
    const patch = { last_attempt_at: now, last_error: error };
    if (ok) patch.last_success_at = now;
    await trx('outage_region_status')
      .insert({ region, ...patch })
      .onConflict('region')
      .merge(patch);
  },

  async regionStatuses(trx = knex) {
    return trx('outage_region_status').select('*');
  },

  async logFetch(entry, trx = knex) {
    await trx('outage_fetch_log').insert(entry);
  },

  async recentFetches(limit = 30, trx = knex) {
    return trx('outage_fetch_log').select('*').orderBy('at', 'desc').limit(limit);
  },

  async pruneFetchLog(trx = knex) {
    await trx('outage_fetch_log')
      .where('at', '<', trx.raw(`now() - interval '${LOG_KEEP_DAYS} days'`))
      .del();
  },

  /** Runs fn only if this process wins a session-level advisory lock. */
  async withAdvisoryLock(key, fn) {
    const conn = await knex.client.acquireConnection();
    try {
      const { rows } = await conn.query('SELECT pg_try_advisory_lock($1) AS ok', [key]);
      if (!rows[0]?.ok) return { skipped: true };
      try {
        return await fn();
      } finally {
        await conn.query('SELECT pg_advisory_unlock($1)', [key]);
      }
    } finally {
      await knex.client.releaseConnection(conn);
    }
  },
};
