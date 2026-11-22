// Wires the pure alert logic to storage and the Telegram API.
import outageModel from '../../../data-layer/models/outage-model.js';
import telegramModel from '../../../data-layer/models/telegram-model.js';
import { addDays, kyivDate } from '../outages/time.js';
import { alertText, dueAlerts, offSpans } from './alerts.js';
import { handleUpdate } from './bot.js';
import { sendMessage } from './api.js';

/** Latest stored queues for today and tomorrow of a region. */
async function regionDays(region, now) {
  const today = kyivDate(new Date(now));
  const snaps = await Promise.all(
    [today, addDays(today, 1)].map((d) => outageModel.latestSnapshot(region, d)),
  );
  return snaps.map((s) => s?.queues ?? []);
}

export async function spansFor(region, queue, now = Date.now()) {
  return offSpans(await regionDays(region, now), queue);
}

/** Chat blocked the bot or was deleted: drop its subscriptions. */
const isGone = (error) => error?.status === 403 || /chat not found/i.test(error?.description ?? '');

/**
 * Sends every due alert once. Returns counts for logging.
 * @param {{ model?: object, send?: Function, daysLoader?: Function, now?: number }} deps
 */
export async function runNotifier({
  model = telegramModel,
  send = sendMessage,
  daysLoader = regionDays,
  now = Date.now(),
} = {}) {
  const subs = await model.all();
  if (!subs.length) return { subs: 0, sent: 0, failed: 0 };
  const days = new Map();
  for (const region of new Set(subs.map((s) => s.region))) days.set(region, await daysLoader(region, now));
  const due = dueAlerts(subs, (r) => days.get(r) ?? [], now);
  let sent = 0;
  let failed = 0;
  for (const alert of due) {
    const startIso = new Date(alert.span.start).toISOString();
    if (!(await model.markSent(alert.sub.id, startIso))) continue;
    try {
      await send(alert.sub.chat_id, alertText(alert, now));
      sent++;
    } catch (error) {
      failed++;
      if (isGone(error)) await model.unsubscribe(alert.sub.chat_id);
      else await model.unmarkSent?.(alert.sub.id, startIso);
      console.warn('[telegram] alert failed:', error.message);
    }
    // Stay well below Telegram's ~30 messages/second limit.
    await new Promise((r) => setTimeout(r, 50));
  }
  return { subs: subs.length, sent, failed };
}

export function processUpdate(update) {
  return handleUpdate(update, {
    model: telegramModel,
    send: (chatId, text) => sendMessage(chatId, text),
    spansFor: (region, queue) => spansFor(region, queue),
  });
}
