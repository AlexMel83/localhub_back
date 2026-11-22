// Read side: turns stored snapshots into the public contract.
import NodeCache from 'node-cache';
import outageModel from '../../../data-layer/models/outage-model.js';
import { REGIONS, getRegion } from './regions.js';
import { addDays, isIsoDate, kyivDate, toKyivIso } from './time.js';
import { diffSlots, regionState } from './schedule.js';
import { HOE_QUEUES } from './providers/hoe.js';

export const STALE_AFTER_MS = 30 * 60 * 1000;
const cache = new NodeCache({ stdTTL: 60, useClones: false });

const iso = (v) => (v ? toKyivIso(new Date(v)) : null);

const SOURCE_BY_PROVIDER = {
  hoe: null, // use the region's official operator
  koe: null,
  'svitlo-dtek': { name: 'svitlo.live', url: 'https://svitlo.live' },
  'svitlo-legacy': { name: 'svitlo.live', url: 'https://svitlo.live' },
  'alerts-energy': { name: 'alerts.energy', url: 'https://alerts.energy' },
};

export function invalidate(region) {
  for (const key of cache.keys()) if (key.includes(`:${region}:`)) cache.del(key);
  cache.del('regions');
}

/** "today" | "tomorrow" | YYYY-MM-DD -> YYYY-MM-DD, or null when invalid. */
export function resolveDate(value, now = new Date()) {
  const today = kyivDate(now);
  if (!value || value === 'today') return today;
  if (value === 'tomorrow') return addDays(today, 1);
  if (!isIsoDate(value)) return null;
  // Keep the archive window bounded.
  const min = addDays(today, -31);
  const max = addDays(today, 2);
  return value >= min && value <= max ? value : null;
}

async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const value = await fn();
  cache.set(key, value);
  return value;
}

async function lastSuccess(region) {
  const rows = await cached('statuses', () => outageModel.regionStatuses());
  return rows.find((r) => r.region === region)?.last_success_at ?? null;
}

export async function listRegions() {
  return cached('regions', async () =>
    REGIONS.map((r) => ({
      slug: r.slug,
      nameUk: r.nameUk,
      nameEn: r.nameEn,
      official: r.official,
      source: { name: r.operator.name, url: r.operator.url },
      queues: r.official ? HOE_QUEUES : [],
    })),
  );
}

export async function getSchedule(regionSlug, date, now = new Date()) {
  const region = getRegion(regionSlug);
  if (!region) return null;
  return cached(`schedule:${regionSlug}:${date}`, async () => {
    const snap = await outageModel.latestSnapshot(regionSlug, date);
    const success = await lastSuccess(regionSlug);
    const stale = !success || now.getTime() - new Date(success).getTime() > STALE_AFTER_MS;
    const queues = snap?.queues ?? [];
    const emergency = Boolean(snap?.emergency);
    const source = (snap && SOURCE_BY_PROVIDER[snap.provider]) || {
      name: region.operator.name,
      url: region.operator.url,
    };
    return {
      region: regionSlug,
      date,
      publishedState: regionState(queues, emergency),
      emergency,
      provider: snap?.provider ?? 'none',
      stale,
      sourcesAgree: snap?.sources_agree ?? null,
      source,
      sourceUpdatedAt: iso(snap?.source_updated_at),
      fetchedAt: iso(snap?.fetched_at),
      lastCheckedAt: iso(success),
      queues,
    };
  });
}

/** Change feed for a date, newest first. The first snapshot is "published". */
export async function getChanges(regionSlug, date) {
  if (!getRegion(regionSlug)) return null;
  return cached(`changes:${regionSlug}:${date}`, async () => {
    const snaps = await outageModel.snapshotsForDate(regionSlug, date);
    const changes = [];
    let prev = null;
    for (const snap of snaps) {
      const prevQueues = new Map((prev?.queues ?? []).map((q) => [q.queue, q.slots]));
      for (const q of snap.queues) {
        const before = prevQueues.get(q.queue) ?? null;
        const { added, removed } = diffSlots(date, before, q.slots);
        if (!added.length && !removed.length) continue;
        changes.push({
          queue: q.queue,
          date,
          kind: prev ? 'updated' : 'published',
          changedAt: iso(snap.fetched_at),
          added,
          removed,
        });
      }
      prev = snap;
    }
    return changes.reverse();
  });
}

export async function health() {
  const [statuses, fetches] = await Promise.all([
    outageModel.regionStatuses(),
    outageModel.recentFetches(20),
  ]);
  return {
    regions: statuses.map((s) => ({
      region: s.region,
      lastSuccessAt: iso(s.last_success_at),
      lastAttemptAt: iso(s.last_attempt_at),
      lastError: s.last_error,
    })),
    fetches: fetches.map((f) => ({ ...f, at: iso(f.at) })),
  };
}

export async function searchAddress(regionSlug, q, settlement) {
  const { addressModel } = await import('../../../data-layer/models/outage-model.js');
  const { parseAddressQuery, groupMatches, normText } = await import('./addresses.js');
  const query = parseAddressQuery(q ?? '');
  if (query.street.length < 2) return { query, matches: [] };
  return cached(`address:${regionSlug}:${normText(settlement)}|${query.street}|${query.house}`, async () => {
    const rows = await addressModel.search({
      region: regionSlug,
      street: query.street,
      settlement: settlement ? normText(settlement) : null,
    });
    return { query, matches: groupMatches(rows, query.house) };
  });
}

export async function listSettlements(regionSlug, q) {
  const { addressModel } = await import('../../../data-layer/models/outage-model.js');
  const { normText } = await import('./addresses.js');
  return cached(`settlements:${regionSlug}:${normText(q)}`, () =>
    addressModel.settlements(regionSlug, normText(q)),
  );
}

export async function listStreets(regionSlug, { settlement, rem, q }) {
  const { addressModel } = await import('../../../data-layer/models/outage-model.js');
  const { normStreet } = await import('./addresses.js');
  const query = normStreet(q ?? '');
  return cached(`streets:${regionSlug}:${settlement}|${rem ?? ''}|${query}`, async () =>
    (await addressModel.streets({ region: regionSlug, settlement, rem, query })).map((r) => r.street),
  );
}

export async function lookupHouse(regionSlug, { settlement, rem, street, house }) {
  const { addressModel } = await import('../../../data-layer/models/outage-model.js');
  const { streetHouses } = await import('./addresses.js');
  const rows = await cached(`street:${regionSlug}:${settlement}|${rem ?? ''}|${street}`, () =>
    addressModel.streetRows({ region: regionSlug, settlement, rem, street }),
  );
  return { settlement, street, ...streetHouses(rows, house) };
}
