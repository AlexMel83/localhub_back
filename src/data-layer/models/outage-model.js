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

const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export const addressModel = {
  async fileMeta(url, trx = knex) {
    return (await trx('outage_address_files').where({ url }).first()) ?? null;
  },

  /** Replaces all rows of one source file atomically. */
  async replaceFile(meta, rows) {
    await knex.transaction(async (trx) => {
      await trx('outage_addresses').where({ file_url: meta.url }).del();
      for (let i = 0; i < rows.length; i += 1000) {
        await trx('outage_addresses').insert(
          rows.slice(i, i + 1000).map((r) => ({
            ...r,
            region: meta.region,
            rem: meta.rem,
            file_url: meta.url,
            file_date: meta.fileDate,
          })),
        );
      }
      const patch = {
        region: meta.region,
        rem: meta.rem,
        last_modified: meta.lastModified,
        rows: rows.length,
        imported_at: trx.fn.now(),
      };
      await trx('outage_address_files')
        .insert({ url: meta.url, ...patch })
        .onConflict('url')
        .merge(patch);
    });
  },

  async count(trx = knex) {
    const [{ count }] = await trx('outage_addresses').count('* as count');
    return Number(count);
  },

  async search({ region, street, settlement, limit = 500 }, trx = knex) {
    const q = trx('outage_addresses')
      .select(
        'settlement',
        'street',
        'houses',
        'queue',
        'rem',
        trx.raw(`to_char(file_date, 'YYYY-MM-DD') as file_date`),
      )
      .where({ region })
      .andWhere('street_norm', 'ilike', `%${escapeLike(street)}%`)
      .limit(limit);
    if (settlement) q.andWhere('settlement_norm', 'ilike', `${escapeLike(settlement)}%`);
    return q;
  },

  async settlements(region, query, trx = knex) {
    const q = trx('outage_addresses')
      .distinct('settlement', 'rem')
      .where({ region })
      .orderBy('settlement')
      .limit(30);
    if (query) q.andWhere('settlement_norm', 'ilike', `${escapeLike(query)}%`);
    return q;
  },
};
