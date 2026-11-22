// Official schedule of JSC "Kharkivoblenergo" from its public Telegram channel
// (web preview https://t.me/s/kharkivenergy). The operator's website sits
// behind a bot challenge, the channel is the open official source.
// A schedule post looks like:
//   ‼️ ... у неділю, 22 листопада, з 06:00 до 24:00 у Харківській області будуть
//   діяти графіки погодинних відключень (ГПВ).
//   1.1 06:00-07:30; 16:00-18:00
//   1.2 14:30-18:00
// Undated posts "застосовано аварійні відключення" switch on emergency
// outages for the day they were published.
import * as cheerio from 'cheerio';
import { politeGet } from './http.js';
import { HOE_QUEUES, headerDate, hoeRegionDay, resolveHoePlans } from './hoe.js';
import { normalizeQueue, parseRanges } from '../schedule.js';
import { kyivDate, parseHm } from '../time.js';

export const KOE_CHANNEL_URL = 'https://t.me/s/kharkivenergy';
export const KOE_QUEUES = HOE_QUEUES;

const SCHEDULE_RE = /(ГПВ|графік\S*\s+погодинних\s+відключень)/i;
const EMERGENCY_RE = /аварійн\S*\s+відключен/i;
const CANCEL_RE = /(не\s+(будуть|буде)\s+(діяти|застосов)|скасовано|скасован[іо])/i;
const QUEUE_LINE_RE = /^\s*(\d{1,2}\s*[.,]\s*\d{1,2})\s*[-–—:]?\s+(.+?)\s*$/;

/**
 * Posts of the channel preview, oldest first.
 * @returns {{ id: string, at: string, text: string }[]}
 */
export function parseKoePosts(html) {
  const $ = cheerio.load(html);
  const posts = [];
  $('.tgme_widget_message[data-post]').each((_, el) => {
    const node = $(el);
    const textHtml = node.find('.tgme_widget_message_text').first().html();
    const at = node.find('time[datetime]').last().attr('datetime');
    if (!textHtml || !at) return;
    const text = cheerio
      .load(`<div>${textHtml.replace(/<br\s*\/?>/gi, '\n')}</div>`)('div')
      .text()
      .replace(/ /g, ' ');
    posts.push({ id: node.attr('data-post'), at, text });
  });
  return posts.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** "06:00-07:30; 17:00:20:30;" -> ranges; fixes the "HH:MM:HH:MM" typo. */
export function parseKoeRanges(text) {
  const clean = String(text)
    .replace(/(\d{1,2}[:.]\d{2})\s*:\s*(\d{1,2}[:.]\d{2})/g, '$1-$2')
    .replace(/[;,.\s]+$/, '');
  return parseRanges(clean);
}

/**
 * Schedule blocks newest first (the shape resolveHoePlans expects) and the
 * Kyiv dates with emergency outages.
 */
export function koeBlocks(posts) {
  const blocks = [];
  const emergencyDates = new Set();
  for (const post of posts) {
    const lines = post.text.split('\n').map((l) => l.trim()).filter(Boolean);
    const postDate = kyivDate(new Date(post.at));
    const headerIdx = lines.findIndex((l) => SCHEDULE_RE.test(l));
    if (headerIdx === -1) {
      if (EMERGENCY_RE.test(post.text) && !CANCEL_RE.test(post.text)) emergencyDates.add(postDate);
      continue;
    }
    const header = lines[headerIdx];
    const date = headerDate(header, postDate);
    if (!date) continue;
    const from = /з\s+(\d{1,2}[:.]\d{2})\s+до/i.exec(header);
    const block = {
      date,
      at: post.at,
      header,
      emergency: EMERGENCY_RE.test(header),
      cancelled: CANCEL_RE.test(header),
      fromMinutes: from ? parseHm(from[1]) : null,
      queues: {},
      invalid: false,
    };
    for (const line of lines.slice(headerIdx + 1)) {
      const m = QUEUE_LINE_RE.exec(line);
      if (!m) continue;
      const queue = normalizeQueue(m[1]);
      if (!queue || !KOE_QUEUES.includes(queue)) continue;
      const ranges = parseKoeRanges(m[2]);
      if (ranges) block.queues[queue] = ranges;
      else block.invalid = true;
    }
    if (!block.invalid && (block.cancelled || Object.keys(block.queues).length)) blocks.push(block);
  }
  return { blocks: blocks.reverse(), emergencyDates };
}

/** Plans per date plus the time of the post that set each one. */
export function resolveKoe(html) {
  const { blocks, emergencyDates } = koeBlocks(parseKoePosts(html));
  const plans = resolveHoePlans(blocks);
  const updatedAt = new Map();
  for (const b of blocks) if (!updatedAt.has(b.date)) updatedAt.set(b.date, b.at);
  return { plans, emergencyDates, updatedAt };
}

/** Normalized RegionDay for one date, or null when the channel has no plan. */
export function koeRegionDay(resolved, date, { region }) {
  const day = hoeRegionDay(resolved.plans, date, {
    region,
    provider: 'koe',
    sourceUpdatedAt: resolved.updatedAt.get(date) ?? null,
  });
  if (!day) return null;
  return { ...day, emergency: day.emergency || resolved.emergencyDates.has(date) };
}

export async function fetchKoe() {
  const res = await politeGet(KOE_CHANNEL_URL, { conditional: false });
  return { html: res.text, ms: res.ms, status: res.status };
}
