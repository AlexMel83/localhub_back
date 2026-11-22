// Starts the outage collector when OUTAGES_COLLECTOR_ENABLED=true.
// Cadence: every 5 minutes; every 2 minutes from 18:00 to 23:59 Kyiv time,
// when next-day schedules are usually published. A Postgres advisory lock
// keeps several app instances from collecting at the same time.
import cron from 'node-cron';
import outageModel, { addressModel } from '../../../data-layer/models/outage-model.js';
import { importAddressFiles } from './address-import.js';
import { collectOnce, shouldRunAt } from './collector.js';
import { invalidate } from './outage-service.js';
import { TZ } from './time.js';

const LOCK_KEY = 6801202611; // arbitrary, stable
let running = false;

export async function runCollector(reason = 'cron') {
  if (running) return { skipped: true };
  running = true;
  try {
    const result = await outageModel.withAdvisoryLock(LOCK_KEY, () =>
      collectOnce({ model: outageModel, onChange: (region) => invalidate(region) }),
    );
    if (!result?.skipped) {
      console.log(`[outages] ${reason}: ${JSON.stringify(result)}`);
    }
    return result;
  } catch (error) {
    console.error('[outages] collector failed:', error.message);
    return { error: error.message };
  } finally {
    running = false;
  }
}

export async function runAddressImport(reason = 'manual') {
  try {
    const result = await importAddressFiles({ model: addressModel });
    console.log(`[outages] address import (${reason}): ${JSON.stringify(result)}`);
    return result;
  } catch (error) {
    console.error('[outages] address import failed:', error.message);
    return { error: error.message };
  }
}

export function startOutageScheduler() {
  if (process.env.OUTAGES_COLLECTOR_ENABLED !== 'true') {
    console.log('[outages] collector disabled (OUTAGES_COLLECTOR_ENABLED != true)');
    return null;
  }
  const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' });
  const task = cron.schedule('* * * * *', () => {
    const now = new Date();
    const hour = Number(hourFmt.format(now));
    if (shouldRunAt(hour, now.getUTCMinutes())) runCollector();
  });
  setTimeout(() => runCollector('startup'), 10_000).unref();
  cron.schedule('17 3 * * *', () => outageModel.pruneFetchLog().catch(() => {}), { timezone: TZ });
  cron.schedule('40 4 * * *', () => runAddressImport('daily'), { timezone: TZ });
  setTimeout(async () => {
    if ((await addressModel.count().catch(() => 1)) === 0) runAddressImport('initial');
  }, 30_000).unref();
  console.log('[outages] collector scheduled');
  return task;
}
