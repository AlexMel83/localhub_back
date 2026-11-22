import knex from '../../../config/knex.config.js';

export default {
  async subscribe(chatId, region, queue, trx = knex) {
    await trx('telegram_subscriptions')
      .insert({ chat_id: chatId, region, queue })
      .onConflict(['chat_id', 'region', 'queue'])
      .ignore();
  },

  async listForChat(chatId, trx = knex) {
    return trx('telegram_subscriptions').select('id', 'region', 'queue').where({ chat_id: chatId }).orderBy('id');
  },

  async unsubscribe(chatId, queue = null, trx = knex) {
    const q = trx('telegram_subscriptions').where({ chat_id: chatId });
    if (queue) q.andWhere({ queue });
    return q.del();
  },

  async all(trx = knex) {
    return trx('telegram_subscriptions').select('id', 'chat_id', 'region', 'queue', 'lead_minutes');
  },

  /** Records an alert; returns false when it was already sent. */
  async markSent(subscriptionId, outageStart, trx = knex) {
    const rows = await trx('telegram_alerts_sent')
      .insert({ subscription_id: subscriptionId, outage_start: outageStart })
      .onConflict(['subscription_id', 'outage_start'])
      .ignore()
      .returning('subscription_id');
    return rows.length > 0;
  },

  async unmarkSent(subscriptionId, outageStart, trx = knex) {
    await trx('telegram_alerts_sent').where({ subscription_id: subscriptionId, outage_start: outageStart }).del();
  },

  async pruneSent(trx = knex) {
    await trx('telegram_alerts_sent').where('outage_start', '<', trx.raw(`now() - interval '3 days'`)).del();
  },
};
