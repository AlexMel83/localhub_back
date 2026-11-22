import { timingSafeEqual } from 'node:crypto';
import { isTelegramEnabled } from '../../service-layer/services/telegram/api.js';
import { processUpdate } from '../../service-layer/services/telegram/telegram-service.js';

function validSecret(header) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || typeof header !== 'string') return false;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default function (app) {
  // Telegram calls this with the secret set via setWebhook(secret_token).
  app.post('/telegram/webhook', (req, res) => {
    if (!isTelegramEnabled() || !validSecret(req.get('X-Telegram-Bot-Api-Secret-Token'))) {
      return res.sendStatus(403);
    }
    // Answer immediately; Telegram retries slow or failed webhooks.
    res.sendStatus(200);
    processUpdate(req.body).catch((error) => console.warn('[telegram] update failed:', error.message));
  });
}
