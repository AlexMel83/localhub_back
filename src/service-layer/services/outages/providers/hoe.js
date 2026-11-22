// Official text schedule of JSC "Khmelnytskoblenergo" (hoe.com.ua).
// The page lists blocks newest first:
//   <p>За розпорядженням НЕК «Укренерго» 22.11.2026 р. ... (ГПВ).</p>
//   <p>Підчерга 1.1 – 14:00-17:00.<br/>Підчерга 1.2 – 10:00-14:00; 20:00-24:00.</p>
// Updated blocks say "... (ГПВ) на 20 листопада (оновлено з 10:30)", meaning
// the new plan applies from 10:30 and earlier hours keep the previous plan.
import * as cheerio from 'cheerio';
import { politeGet } from './http.js';
import {
  buildQueueDay,
  compareQueues,
  normalizeQueue,
  parseRanges,
  slotsFromRanges,
} from '../schedule.js';
import { SLOT_MINUTES, parseHm } from '../time.js';

export const HOE_URL = 'https://hoe.com.ua/page/pogodinni-vidkljuchennja';
export const HOE_QUEUES = ['1.1', '1.2', '2.1', '2.2', '3.1', '3.2', '4.1', '4.2', '5.1', '5.2', '6.1', '6.2'];

const MONTHS = {
  січня: 1,
  лютого: 2,
  березня: 3,
  квітня: 4,
  травня: 5,
  червня: 6,
  липня: 7,
  серпня: 8,
  вересня: 9,
  жовтня: 10,
  листопада: 11,
  грудня: 12,
};

const HEADER_RE = /(ГПВ|ГАВ|графік\S*\s+(погодинн|аварійн))/i;
const QUEUE_RE = /^\s*Підчерг[аи]\s+(\d{1,2}\s*[.,]\s*\d{1,2})\s*[-–—:]\s*(.+?)\s*$/i;
const NO_OUTAGE_RE = /(не\s+вимика|без\s+відключ|не\s+застосов|відсутн)/i;

const pad = (n) => String(n).padStart(2, '0');

/** Picks the year that puts day/month closest to the reference date. */
function inferDate(day, month, refDate) {
  const refYear = Number(refDate.slice(0, 4));
  let best = null;
  for (const y of [refYear - 1, refYear, refYear + 1]) {
    const iso = `${y}-${pad(month)}-${pad(day)}`;
    const diff = Math.abs(Date.parse(iso) - Date.parse(refDate));
    if (!best || diff < best.diff) best = { iso, diff };
  }
  return best.iso;
}

/** Extracts the schedule date from a block header. */
export function headerDate(text, refDate) {
  const numeric = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(text);
  if (numeric) {
    return `${numeric[3]}-${pad(Number(numeric[2]))}-${pad(Number(numeric[1]))}`;
  }
  const verbal = /(\d{1,2})\s+(січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня)/i.exec(
    text,
  );
  if (verbal) return inferDate(Number(verbal[1]), MONTHS[verbal[2].toLowerCase()], refDate);
  return null;
}

/** Paragraph texts with <br> turned into line breaks. */
function paragraphLines($) {
  const lines = [];
  const root = $('.content-main').length ? $('.content-main') : $('body');
  root.find('p').each((_, el) => {
    const html = $(el).html() ?? '';
    const text = cheerio
      .load(`<div>${html.replace(/<br\s*\/?>/gi, '\n')}</div>`)('div')
      .text();
    for (const line of text.split('\n')) {
      const clean = line.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
      if (clean) lines.push(clean);
    }
  });
  return lines;
}

/**
 * Parses the page into blocks in page order (newest first).
 * @returns {{ date: string, header: string, emergency: boolean, fromMinutes: number|null,
 *   queues: Record<string, Array<[number, number]>> }[]}
 */
export function parseHoeBlocks(html, refDate) {
  const $ = cheerio.load(html);
  const blocks = [];
  let current = null;
  for (const line of paragraphLines($)) {
    const q = QUEUE_RE.exec(line);
    if (q && current) {
      const queue = normalizeQueue(q[1]);
      const ranges = NO_OUTAGE_RE.test(q[2]) ? [] : parseRanges(q[2]);
      if (queue && ranges) current.queues[queue] = ranges;
      else current.invalid = true;
      continue;
    }
    if (HEADER_RE.test(line)) {
      const date = headerDate(line, refDate);
      if (!date) {
        current = null;
        continue;
      }
      const from = /оновлено\s+з\s+(\d{1,2}[:.]\d{2})/i.exec(line);
      current = {
        date,
        header: line,
        emergency: /ГАВ|аварійн/i.test(line),
        cancelled: /(^|\s)не\s+(буд|застосов)/i.test(line),
        fromMinutes: from ? parseHm(from[1]) : null,
        queues: {},
        invalid: false,
      };
      blocks.push(current);
    }
  }
  return blocks.filter((b) => !b.invalid);
}

/**
 * Resolves the effective plan per date: oldest to newest, applying
 * "з HH:MM" partial updates on top of the previous plan.
 * @returns {Map<string, { slots: Record<string, string[]>, emergency: boolean, cancelled: boolean, header: string }>}
 */
export function resolveHoePlans(blocks) {
  const plans = new Map();
  for (const block of [...blocks].reverse()) {
    const prev = plans.get(block.date);
    const slots = {};
    for (const queue of HOE_QUEUES) {
      const ranges = block.queues[queue];
      let next;
      if (ranges) next = slotsFromRanges(ranges);
      else if (block.cancelled) next = slotsFromRanges([]);
      else next = prev?.slots[queue] ?? null;
      if (next && block.fromMinutes !== null && prev?.slots[queue]) {
        const cut = Math.floor(block.fromMinutes / SLOT_MINUTES);
        next = next.map((s, i) => (i < cut ? prev.slots[queue][i] : s));
      }
      if (next) slots[queue] = next;
    }
    const hasQueues = Object.keys(slots).length > 0;
    if (!hasQueues && !block.cancelled) continue;
    plans.set(block.date, {
      slots,
      emergency: block.emergency,
      cancelled: block.cancelled,
      header: block.header,
    });
  }
  return plans;
}

/** Normalized RegionDay for one date, or null when HOE has no plan for it. */
export function hoeRegionDay(plans, date, { region, sourceUpdatedAt = null, provider = 'hoe' }) {
  const plan = plans.get(date);
  if (!plan) return null;
  const queues = HOE_QUEUES.filter((q) => plan.slots[q]).map((q) =>
    buildQueueDay(date, q, plan.slots[q]),
  );
  if (!queues.length) return null;
  queues.sort((a, b) => compareQueues(a.queue, b.queue));
  return {
    region,
    date,
    provider,
    emergency: plan.emergency,
    sourceUpdatedAt,
    queues,
  };
}

export async function fetchHoe() {
  const res = await politeGet(HOE_URL, { conditional: false });
  return { html: res.text, ms: res.ms, status: res.status };
}

