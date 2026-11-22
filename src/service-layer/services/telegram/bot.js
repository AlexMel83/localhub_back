// Handles incoming Telegram updates (webhook). Subscriptions come from deep
// links on the site: https://t.me/<bot>?start=<region>_<queue>, e.g.
// ?start=khmelnytska-oblast_3-1.
import { getRegion } from '../outages/regions.js';
import { normalizeQueue } from '../outages/schedule.js';
import { SITE_URL, queuePageUrl, upcomingText } from './alerts.js';

export const MAX_SUBSCRIPTIONS = 5;

/** "khmelnytska-oblast_3-1" -> { region, queue } or null. */
export function parseStartPayload(payload) {
  const m = /^([a-z0-9-]{2,64})_(\d{1,2}-\d{1,2})$/.exec(String(payload ?? '').trim());
  if (!m) return null;
  const region = getRegion(m[1]);
  const queue = normalizeQueue(m[2]);
  return region && queue ? { region: region.slug, queue } : null;
}

const HELP = [
  'Я надсилаю сповіщення за 30 хвилин до планового відключення світла.',
  '',
  `1. Відкрийте ${SITE_URL}/svitlo-cherga і оберіть свою чергу.`,
  '2. Натисніть «Сповіщення в Telegram».',
  '',
  'Команди: /list — мої черги, /stop — вимкнути все, /stop 3.1 — вимкнути одну чергу.',
].join('\n');

/**
 * @param {object} update Telegram Update
 * @param {{ model: object, send: (chatId: number, text: string) => Promise<unknown>,
 *   spansFor: (region: string, queue: string) => Promise<{start:number,end:number}[]>, now?: () => number }} deps
 */
export async function handleUpdate(update, { model, send, spansFor, now = Date.now }) {
  const msg = update?.message;
  const chatId = msg?.chat?.id;
  const text = typeof msg?.text === 'string' ? msg.text.trim() : '';
  if (!chatId || !text) return;
  const [rawCommand, ...args] = text.split(/\s+/);
  const command = rawCommand.toLowerCase().replace(/@\w+$/, '');

  if (command === '/start') {
    const target = parseStartPayload(args[0]);
    if (!target) return send(chatId, `Вітаю! ${HELP}`);
    const existing = await model.listForChat(chatId);
    const already = existing.some((s) => s.region === target.region && s.queue === target.queue);
    if (!already && existing.length >= MAX_SUBSCRIPTIONS) {
      return send(chatId, `Можна підписатися щонайбільше на ${MAX_SUBSCRIPTIONS} черг. Вимкніть зайві командою /stop 1.1`);
    }
    await model.subscribe(chatId, target.region, target.queue);
    const spans = await spansFor(target.region, target.queue);
    return send(
      chatId,
      [
        `✅ Сповіщення увімкнено: повідомлю за 30 хв до кожного відключення.`,
        '',
        upcomingText(target.region, target.queue, spans, now()),
        '',
        `<a href="${queuePageUrl(target.region, target.queue)}">Графік на сайті</a> · /stop ${target.queue} — вимкнути`,
      ].join('\n'),
    );
  }

  if (command === '/list') {
    const subs = await model.listForChat(chatId);
    if (!subs.length) return send(chatId, `У вас немає підписок.\n\n${HELP}`);
    const parts = [];
    for (const s of subs) parts.push(upcomingText(s.region, s.queue, await spansFor(s.region, s.queue), now()));
    return send(chatId, parts.join('\n\n'));
  }

  if (command === '/stop') {
    const queue = args[0] ? normalizeQueue(args[0]) : null;
    const removed = await model.unsubscribe(chatId, queue);
    if (!removed) return send(chatId, queue ? `Підписки на чергу ${queue} немає. /list — мої черги` : 'У вас немає підписок.');
    return send(chatId, queue ? `🔕 Сповіщення для черги ${queue} вимкнено.` : '🔕 Усі сповіщення вимкнено.');
  }

  return send(chatId, HELP);
}
