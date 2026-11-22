/**
 * Telegram outage alerts: who wants alerts for which queue, and which
 * alerts were already sent (one per subscription and outage start).
 * @param { import("knex").Knex } knex
 */
export const up = async (knex) => {
  await knex.schema.createTable('telegram_subscriptions', (table) => {
    table.bigIncrements('id').primary();
    table.bigInteger('chat_id').notNullable();
    table.string('region', 64).notNullable();
    table.string('queue', 8).notNullable();
    table.integer('lead_minutes').notNullable().defaultTo(30);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.unique(['chat_id', 'region', 'queue']);
    table.index(['region', 'queue']);
  });
  await knex.schema.createTable('telegram_alerts_sent', (table) => {
    table.bigInteger('subscription_id').notNullable().references('id').inTable('telegram_subscriptions').onDelete('CASCADE');
    table.timestamp('outage_start', { useTz: true }).notNullable();
    table.timestamp('sent_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['subscription_id', 'outage_start']);
  });
};

/** @param { import("knex").Knex } knex */
export const down = async (knex) => {
  await knex.schema.dropTableIfExists('telegram_alerts_sent');
  await knex.schema.dropTableIfExists('telegram_subscriptions');
};
