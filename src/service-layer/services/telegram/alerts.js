// Pure logic for Telegram outage alerts: merged outage spans, which alerts
// are due, and message texts.
import { getRegion } from '../outages/regions.js';
import { TZ } from '../outages/time.js';

export const SITE_URL = (process.env.SITE_URL || 'https://json63.pp.ua').replace(/\/$/, '');

const hmFormat = new Intl.DateTimeFormat('uk-UA', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dayFormat = new Intl.DateTimeFormat('uk-UA', { timeZone: TZ, day: 'numeric', month: 'long' });

export const hm = (ms) => hmFormat.format(new Date(ms));

export function duration(minutes) {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h && r) return `${h} год ${r} хв`;
  if (h) return `${h} год`;
  return `${r} хв`;
}

/**
 * Off spans for one queue across consecutive days, merged when they touch
 * (an outage 20:00-24:00 followed by 00:00-02:00 is one span).
 * @param {Array<{ queue: string, intervals: { start: string, end: string, status: string }[] }[]>} days
 */
export function offSpans(days, queue) {
  const spans = days
    .flatMap((queues) => queues.find((q) => q.queue === queue)?.intervals ?? [])
    .filter((i) => i.status === 'off')
    .map((i) => ({ start: Date.parse(i.start), end: Date.parse(i.end) }))
    .sort((a, b) => a.start - b.start);
  const out = [];
  for (const s of spans) {
    const last = out.at(-1);
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

/**
 * Alerts due now: an outage starts within the subscription's lead time.
 * Late runs still alert as long as the outage has not started yet.
 * @param {{ id: number, chat_id: number, region: string, queue: string, lead_minutes: number }[]} subs
 * @param {(region: string) => Array<Array<{queue: string, intervals: object[]}>>} daysFor
 */
export function dueAlerts(subs, daysFor, now) {
  const due = [];
  for (const sub of subs) {
    const lead = (sub.lead_minutes ?? 30) * 60000;
    for (const span of offSpans(daysFor(sub.region), sub.queue)) {
      if (span.start - lead <= now && now < span.start) due.push({ sub, span });
    }
  }
  return due;
}

export const queuePageUrl = (region, queue) => `${SITE_URL}/svitlo-cherga/${region}/${queue.replace('.', '-')}`;

const regionName = (slug) => getRegion(slug)?.nameUk ?? slug;

export function alertText({ sub, span }, now) {
  const minutes = Math.max(1, Math.round((span.start - now) / 60000));
  return [
    `⚡ <b>Через ${duration(minutes)} (о ${hm(span.start)}) за графіком відключення світла</b>`,
    `Черга ${sub.queue} · ${regionName(sub.region)}`,
    `Без світла до ${hm(span.end)} (${duration((span.end - span.start) / 60000)})`,
    '',
    `<a href="${queuePageUrl(sub.region, sub.queue)}">Графік черги ${sub.queue}</a>`,
    '<i>Графік — це план. Можливі зміни та аварійні відключення.</i>',
  ].join('\n');
}

/** Short summary of upcoming outages for /start and /list replies. */
export function upcomingText(region, queue, spans, now) {
  const next = spans.filter((s) => s.end > now).slice(0, 4);
  const head = `Черга <b>${queue}</b> · ${regionName(region)}`;
  if (!next.length) return `${head}\nНайближчих відключень за опублікованим графіком немає.`;
  const lines = next.map((s) => {
    const day = dayFormat.format(new Date(s.start));
    const ongoing = s.start <= now ? ' — <b>зараз</b>' : '';
    return `• ${day}, ${hm(s.start)}–${hm(s.end)}${ongoing}`;
  });
  return `${head}\n${lines.join('\n')}`;
}
