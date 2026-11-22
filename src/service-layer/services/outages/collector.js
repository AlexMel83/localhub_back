// One collection run: fetch every source once, normalize per region and
// date (today, tomorrow), choose the best candidate and store a snapshot
// only when the schedule actually changed.
import { REGIONS } from './regions.js';
import { addDays, kyivDate } from './time.js';
import { regionState, slotsSignature } from './schedule.js';
import { fetchHoe, parseHoeBlocks, resolveHoePlans, hoeRegionDay } from './providers/hoe.js';
import {
  DTEK_URL,
  LEGACY_URL,
  fetchSvitlo,
  normalizeSvitloRegion,
} from './providers/svitlo-proxy.js';

/** Signature of a whole region day: emergency flag + every queue's slots. */
export function regionSignature(day) {
  const queues = day.queues.map((q) => `${q.queue}:${slotsSignature(q.slots)}`).join('|');
  return `${day.emergency ? 'E' : 'N'}|${queues}`;
}

const isPublished = (day) => day && regionState(day.queues, false) !== 'not_published';

/**
 * Picks the first published candidate (priority order). sourcesAgree compares
 * it with the next published candidate, when there is one.
 */
export function chooseCandidate(candidates) {
  const available = candidates.filter(Boolean);
  if (!available.length) return null;
  const published = available.filter(isPublished);
  const pick = published[0] ?? available[0];
  let sourcesAgree = null;
  if (published.length > 1) {
    const sig = (d) => d.queues.map((q) => `${q.queue}:${slotsSignature(q.slots)}`).join('|');
    sourcesAgree = sig(published[0]) === sig(published[1]);
  }
  const emergency = available.some((d) => d.emergency);
  return { ...pick, emergency, sourcesAgree };
}

/** Collector cadence: every 5 minutes; every 2 minutes from 18:00 Kyiv. */
export function shouldRunAt(kyivHour, minute) {
  return kyivHour >= 18 ? minute % 2 === 0 : minute % 5 === 0;
}

async function timed(provider, fn, log) {
  const started = Date.now();
  try {
    const out = await fn();
    await log({ provider, ok: true, status: out?.status ?? 200, ms: Date.now() - started });
    return out;
  } catch (error) {
    await log({
      provider,
      ok: false,
      status: error.status ?? null,
      ms: Date.now() - started,
      error: String(error.message ?? error).slice(0, 500),
    });
    return null;
  }
}

/**
 * @param {{ now?: Date, model: ReturnType<typeof import('../../../data-layer/models/outage-model.js')['default']>,
 *   fetchers?: { hoe?: Function, dtek?: Function, legacy?: Function }, onChange?: Function }} opts
 */
export async function collectOnce({ now = new Date(), model, fetchers = {}, onChange } = {}) {
  const today = kyivDate(now);
  const dates = [today, addDays(today, 1)];
  const log = (entry) => model.logFetch(entry).catch(() => {});

  const [hoe, dtek, legacy] = await Promise.all([
    timed('hoe', fetchers.hoe ?? fetchHoe, log),
    timed('svitlo-dtek', fetchers.dtek ?? (() => fetchSvitlo(DTEK_URL)), log),
    timed('svitlo-legacy', fetchers.legacy ?? (() => fetchSvitlo(LEGACY_URL)), log),
  ]);

  let hoePlans = null;
  if (hoe?.html) {
    try {
      hoePlans = resolveHoePlans(parseHoeBlocks(hoe.html, today));
    } catch (error) {
      await log({ provider: 'hoe-parse', ok: false, error: String(error.message) });
    }
  }

  const summary = { stored: 0, unchanged: 0, missing: 0 };
  for (const region of REGIONS) {
    let regionOk = false;
    for (const date of dates) {
      const ctx = { region: region.slug };
      const candidates = [
        region.official && hoePlans ? hoeRegionDay(hoePlans, date, ctx) : null,
        dtek && region.dtekCpu
          ? normalizeSvitloRegion(dtek.payload, region.dtekCpu, date, {
              ...ctx,
              provider: 'svitlo-dtek',
              sourceUpdatedAt: dtek.sourceUpdatedAt,
            })
          : null,
        legacy && region.legacyCpu
          ? normalizeSvitloRegion(legacy.payload, region.legacyCpu, date, {
              ...ctx,
              provider: 'svitlo-legacy',
              sourceUpdatedAt: null,
            })
          : null,
      ];
      const chosen = chooseCandidate(candidates);
      if (!chosen) {
        summary.missing++;
        continue;
      }
      regionOk = true;
      const signature = regionSignature(chosen);
      const latest = await model.latestSnapshot(region.slug, date);
      if (latest?.signature === signature) {
        summary.unchanged++;
        continue;
      }
      await model.insertSnapshot({
        region: region.slug,
        date,
        provider: chosen.provider,
        emergency: chosen.emergency,
        sources_agree: chosen.sourcesAgree,
        signature,
        queues: chosen.queues,
        source_updated_at: chosen.sourceUpdatedAt,
      });
      summary.stored++;
      onChange?.(region.slug, date);
    }
    await model.markRegion(region.slug, {
      ok: regionOk,
      error: regionOk ? null : 'no source returned data',
    });
  }
  return summary;
}
