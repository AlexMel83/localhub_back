// Polite HTTP GET for public sources: identifies the bot, times out,
// and supports conditional requests via ETag / Last-Modified.

const DEFAULT_UA =
  process.env.OUTAGES_USER_AGENT ||
  'LocalHubBot/1.0 (+https://json63.pp.ua/svitlo-cherga)';

/** @type {Map<string, { etag?: string, lastModified?: string }>} */
const validators = new Map();

export class HttpError extends Error {
  constructor(url, status) {
    super(`GET ${url} -> ${status}`);
    this.status = status;
  }
}

/**
 * @returns {Promise<{ status: number, notModified: boolean, text: string, headers: Headers, ms: number }>}
 */
export async function politeGet(url, { timeoutMs = 20000, conditional = true } = {}) {
  const headers = { 'User-Agent': DEFAULT_UA, Accept: '*/*' };
  const v = validators.get(url);
  if (conditional && v?.etag) headers['If-None-Match'] = v.etag;
  if (conditional && v?.lastModified) headers['If-Modified-Since'] = v.lastModified;

  const started = Date.now();
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const ms = Date.now() - started;
  if (res.status === 304) {
    return { status: 304, notModified: true, text: '', headers: res.headers, ms };
  }
  if (!res.ok) throw new HttpError(url, res.status);
  const etag = res.headers.get('etag') ?? undefined;
  const lastModified = res.headers.get('last-modified') ?? undefined;
  if (etag || lastModified) validators.set(url, { etag, lastModified });
  return { status: res.status, notModified: false, text: await res.text(), headers: res.headers, ms };
}

/** GET a binary file; returns null when unchanged since `lastModified`. */
export async function politeGetBuffer(url, { lastModified, timeoutMs = 60000 } = {}) {
  const headers = { 'User-Agent': DEFAULT_UA, Accept: '*/*' };
  if (lastModified) headers['If-Modified-Since'] = lastModified;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (res.status === 304) return null;
  if (!res.ok) throw new HttpError(url, res.status);
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    lastModified: res.headers.get('last-modified'),
  };
}
