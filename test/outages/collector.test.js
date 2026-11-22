import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  chooseCandidate,
  collectOnce,
  shouldRunAt,
} from '../../src/service-layer/services/outages/collector.js';
import { parseSvitloPayload } from '../../src/service-layer/services/outages/providers/svitlo-proxy.js';
import { buildQueueDay, slotsFromRanges } from '../../src/service-layer/services/outages/schedule.js';

const fx = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const NOW = new Date('2026-11-22T12:00:00+02:00');

function memoryModel() {
  const snapshots = [];
  const logs = [];
  const status = new Map();
  return {
    snapshots,
    logs,
    status,
    async latestSnapshot(region, date) {
      return snapshots.filter((s) => s.region === region && s.date === date).at(-1) ?? null;
    },
    async insertSnapshot(row) {
      snapshots.push({ ...row, id: snapshots.length + 1 });
    },
    async markRegion(region, s) {
      status.set(region, s);
    },
    async logFetch(entry) {
      logs.push(entry);
    },
  };
}

const fetchers = {
  hoe: async () => ({ html: fx('hoe-2026-11-22.html'), status: 200 }),
  dtek: async () => ({ ...parseSvitloPayload(fx('svitlo-dtek-2026-11-22.json')), status: 200 }),
  legacy: async () => ({ ...parseSvitloPayload(fx('svitlo-legacy-2026-11-22.json')), status: 200 }),
};

test('first run stores today from HOE and tomorrow from svitlo; second run is a no-op', async () => {
  const model = memoryModel();
  const changed = [];
  const first = await collectOnce({ now: NOW, model, fetchers, onChange: (r, d) => changed.push(`${r}/${d}`) });
  assert.ok(first.stored >= 3);
  const today = model.snapshots.find((s) => s.region === 'khmelnytska-oblast' && s.date === '2026-11-22');
  assert.equal(today.provider, 'hoe');
  assert.equal(today.sources_agree, true);
  const tomorrow = model.snapshots.find((s) => s.region === 'khmelnytska-oblast' && s.date === '2026-11-23');
  assert.equal(tomorrow.provider, 'svitlo-dtek');
  assert.ok(tomorrow.queues.every((q) => q.publishedState === 'not_published'));
  assert.equal(model.status.get('khmelnytska-oblast').ok, true);
  assert.ok(changed.includes('khmelnytska-oblast/2026-11-22'));

  const second = await collectOnce({ now: NOW, model, fetchers });
  assert.equal(second.stored, 0);
  assert.equal(model.logs.filter((l) => !l.ok).length, 0);
});

test('HOE down: falls back to svitlo and logs the failure', async () => {
  const model = memoryModel();
  const failing = {
    ...fetchers,
    hoe: async () => {
      const e = new Error('HTTP 503');
      e.status = 503;
      throw e;
    },
  };
  await collectOnce({ now: NOW, model, fetchers: failing });
  const today = model.snapshots.find((s) => s.region === 'khmelnytska-oblast' && s.date === '2026-11-22');
  assert.equal(today.provider, 'svitlo-dtek');
  assert.deepEqual(
    model.logs.filter((l) => !l.ok).map((l) => [l.provider, l.status]),
    [['hoe', 503]],
  );
});

test('all sources down: nothing stored, regions marked failed', async () => {
  const model = memoryModel();
  const boom = async () => {
    throw new Error('offline');
  };
  const res = await collectOnce({ now: NOW, model, fetchers: { hoe: boom, dtek: boom, legacy: boom } });
  assert.equal(res.stored, 0);
  assert.equal(model.status.get('khmelnytska-oblast').ok, false);
});

test('chooseCandidate prefers published data and flags disagreement', () => {
  const day = (provider, ranges, emergency = false) => ({
    provider,
    emergency,
    queues: [buildQueueDay('2026-11-22', '1.1', slotsFromRanges(ranges))],
  });
  const unpublished = {
    provider: 'x',
    emergency: false,
    queues: [buildQueueDay('2026-11-22', '1.1', Array(48).fill('unknown'))],
  };
  const pick = chooseCandidate([unpublished, day('a', [[0, 60]]), day('b', [[0, 120]], true)]);
  assert.equal(pick.provider, 'a');
  assert.equal(pick.sourcesAgree, false);
  assert.equal(pick.emergency, true);
  assert.equal(chooseCandidate([null, null]), null);
});

test('cadence: every 5 minutes by day, every 2 in the evening', () => {
  assert.ok(shouldRunAt(10, 5));
  assert.ok(!shouldRunAt(10, 4));
  assert.ok(shouldRunAt(19, 4));
  assert.ok(!shouldRunAt(19, 5));
});
