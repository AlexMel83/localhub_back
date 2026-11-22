import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  alertText,
  dueAlerts,
  offSpans,
  upcomingText,
} from '../../src/service-layer/services/telegram/alerts.js';
import { handleUpdate, parseStartPayload } from '../../src/service-layer/services/telegram/bot.js';
import { runNotifier } from '../../src/service-layer/services/telegram/telegram-service.js';

const T = (iso) => Date.parse(iso);
const iv = (start, end, status = 'off') => ({ start, end, status });
const today = [
  {
    queue: '3.1',
    intervals: [
      iv('2026-11-22T06:00:00+02:00', '2026-11-22T10:00:00+02:00'),
      iv('2026-11-22T17:00:00+02:00', '2026-11-22T21:00:00+02:00'),
      iv('2026-11-22T22:00:00+02:00', '2026-11-23T00:00:00+02:00'),
      iv('2026-11-22T12:00:00+02:00', '2026-11-22T13:00:00+02:00', 'maybe'),
    ],
  },
];
const tomorrow = [{ queue: '3.1', intervals: [iv('2026-11-23T00:00:00+02:00', '2026-11-23T02:00:00+02:00')] }];
const sub = { id: 1, chat_id: 42, region: 'khmelnytska-oblast', queue: '3.1', lead_minutes: 30 };

test('offSpans merges an outage across midnight and ignores maybe', () => {
  const spans = offSpans([today, tomorrow], '3.1');
  assert.equal(spans.length, 3);
  assert.equal(spans[2].start, T('2026-11-22T22:00:00+02:00'));
  assert.equal(spans[2].end, T('2026-11-23T02:00:00+02:00'));
  assert.deepEqual(offSpans([today], '9.9'), []);
});

test('dueAlerts fires within the 30-minute window only', () => {
  const days = () => [today, tomorrow];
  assert.equal(dueAlerts([sub], days, T('2026-11-22T16:29:00+02:00')).length, 0);
  assert.equal(dueAlerts([sub], days, T('2026-11-22T16:30:00+02:00')).length, 1);
  assert.equal(dueAlerts([sub], days, T('2026-11-22T16:55:00+02:00')).length, 1);
  assert.equal(dueAlerts([sub], days, T('2026-11-22T17:00:00+02:00')).length, 0);
  // The 00:00 continuation of the 22:00 outage is not a separate alert.
  assert.equal(dueAlerts([sub], days, T('2026-11-22T23:45:00+02:00')).length, 0);
});

test('alert and summary texts', () => {
  const span = { start: T('2026-11-22T17:00:00+02:00'), end: T('2026-11-22T21:00:00+02:00') };
  const text = alertText({ sub, span }, T('2026-11-22T16:30:00+02:00'));
  assert.match(text, /Через 30 хв \(о 17:00\)/);
  assert.match(text, /Без світла до 21:00 \(4 год\)/);
  assert.match(text, /svitlo-cherga\/khmelnytska-oblast\/3-1/);
  const summary = upcomingText('khmelnytska-oblast', '3.1', offSpans([today, tomorrow], '3.1'), T('2026-11-22T07:00:00+02:00'));
  assert.match(summary, /06:00–10:00 — <b>зараз<\/b>/);
  assert.match(summary, /22:00–02:00/);
});

test('parseStartPayload validates region and queue', () => {
  assert.deepEqual(parseStartPayload('khmelnytska-oblast_3-1'), { region: 'khmelnytska-oblast', queue: '3.1' });
  assert.equal(parseStartPayload('atlantis_3-1'), null);
  assert.equal(parseStartPayload('khmelnytska-oblast_x'), null);
  assert.equal(parseStartPayload(undefined), null);
});

function fakeModel() {
  const subs = [];
  const sent = new Set();
  return {
    subs,
    sent,
    async subscribe(chat_id, region, queue) {
      if (!subs.some((s) => s.chat_id === chat_id && s.region === region && s.queue === queue))
        subs.push({ id: subs.length + 1, chat_id, region, queue, lead_minutes: 30 });
    },
    async listForChat(chatId) {
      return subs.filter((s) => s.chat_id === chatId);
    },
    async unsubscribe(chatId, queue = null) {
      const before = subs.length;
      for (let i = subs.length - 1; i >= 0; i--)
        if (subs[i].chat_id === chatId && (!queue || subs[i].queue === queue)) subs.splice(i, 1);
      return before - subs.length;
    },
    async all() {
      return [...subs];
    },
    async markSent(id, start) {
      const key = `${id}|${start}`;
      if (sent.has(key)) return false;
      sent.add(key);
      return true;
    },
    async unmarkSent(id, start) {
      sent.delete(`${id}|${start}`);
    },
  };
}

test('bot: /start subscribes, /list shows, /stop removes', async () => {
  const model = fakeModel();
  const out = [];
  const deps = {
    model,
    send: async (chatId, text) => out.push([chatId, text]),
    spansFor: async () => offSpans([today, tomorrow], '3.1'),
    now: () => T('2026-11-22T12:00:00+02:00'),
  };
  const msg = (text) => ({ message: { chat: { id: 42 }, text } });
  await handleUpdate(msg('/start khmelnytska-oblast_3-1'), deps);
  assert.equal(model.subs.length, 1);
  assert.match(out.at(-1)[1], /Сповіщення увімкнено/);
  await handleUpdate(msg('/start khmelnytska-oblast_3-1'), deps);
  assert.equal(model.subs.length, 1);
  await handleUpdate(msg('/list'), deps);
  assert.match(out.at(-1)[1], /17:00–21:00/);
  await handleUpdate(msg('/stop 3.1'), deps);
  assert.equal(model.subs.length, 0);
  await handleUpdate(msg('/start'), deps);
  assert.match(out.at(-1)[1], /Вітаю/);
  await handleUpdate({ message: { chat: { id: 42 } } }, deps);
  assert.equal(out.length, 5);
});

test('bot: limits subscriptions per chat', async () => {
  const model = fakeModel();
  const out = [];
  const deps = { model, send: async (c, t) => out.push(t), spansFor: async () => [], now: () => 0 };
  for (const q of ['1-1', '1-2', '2-1', '2-2', '3-1', '3-2']) {
    await handleUpdate({ message: { chat: { id: 7 }, text: `/start khmelnytska-oblast_${q}` } }, deps);
  }
  assert.equal(model.subs.length, 5);
  assert.match(out.at(-1), /щонайбільше на 5/);
});

test('runNotifier sends once, retries on failure, drops blocked chats', async () => {
  const model = fakeModel();
  await model.subscribe(42, 'khmelnytska-oblast', '3.1');
  await model.subscribe(43, 'khmelnytska-oblast', '3.1');
  const now = T('2026-11-22T16:40:00+02:00');
  const daysLoader = async () => [today, tomorrow];
  const sent = [];
  let fail43 = { status: 500, message: 'boom' };
  const send = async (chatId, text) => {
    if (chatId === 43 && fail43) throw Object.assign(new Error(fail43.message), fail43);
    sent.push([chatId, text]);
  };
  let res = await runNotifier({ model, send, daysLoader, now });
  assert.deepEqual(res, { subs: 2, sent: 1, failed: 1 });
  res = await runNotifier({ model, send, daysLoader, now });
  assert.deepEqual(res, { subs: 2, sent: 0, failed: 1 }); // 42 deduped, 43 retried
  fail43 = { status: 403, message: 'Forbidden: bot was blocked by the user' };
  await runNotifier({ model, send, daysLoader, now });
  assert.deepEqual(model.subs.map((s) => s.chat_id), [42]);
  assert.equal(sent.length, 1);
});
