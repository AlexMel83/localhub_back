// Minimal Telegram Bot API client (no SDK).

export const isTelegramEnabled = () => Boolean(process.env.TELEGRAM_BOT_TOKEN);

export class TelegramError extends Error {
  constructor(method, status, description) {
    super(`telegram ${method}: ${status} ${description}`);
    this.status = status;
    this.description = description;
  }
}

export async function callTelegram(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    throw new TelegramError(method, body.error_code ?? res.status, body.description ?? res.statusText);
  }
  return body.result;
}

export const sendMessage = (chatId, text, extra = {}) =>
  callTelegram('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...extra,
  });

/** Registers the webhook when TELEGRAM_WEBHOOK_URL is configured. */
export async function ensureWebhook() {
  const url = process.env.TELEGRAM_WEBHOOK_URL;
  if (!isTelegramEnabled() || !url) return false;
  await callTelegram('setWebhook', {
    url,
    secret_token: process.env.TELEGRAM_WEBHOOK_SECRET || undefined,
    allowed_updates: ['message'],
    drop_pending_updates: false,
  });
  await callTelegram('setMyCommands', {
    commands: [
      { command: 'list', description: 'Мої черги та найближчі відключення' },
      { command: 'stop', description: 'Вимкнути сповіщення' },
      { command: 'help', description: 'Як підписатися' },
    ],
  });
  return true;
}
