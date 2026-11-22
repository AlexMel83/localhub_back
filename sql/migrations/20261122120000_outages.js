/**
 * Outage schedule collector storage.
 * @param { import("knex").Knex } knex
 */
export const up = async (knex) => {
  await knex.schema.createTable('outage_snapshots', (table) => {
    table.bigIncrements('id').primary();
    table.string('region', 64).notNullable();
    table.date('date').notNullable();
    table.string('provider', 32).notNullable();
    table.boolean('emergency').notNullable().defaultTo(false);
    table.boolean('sources_agree').nullable();
    table.text('signature').notNullable();
    table.jsonb('queues').notNullable();
    table.timestamp('source_updated_at', { useTz: true }).nullable();
    table.timestamp('fetched_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(['region', 'date', 'fetched_at']);
  });
  await knex.schema.createTable('outage_region_status', (table) => {
    table.string('region', 64).primary();
    table.timestamp('last_attempt_at', { useTz: true }).nullable();
    table.timestamp('last_success_at', { useTz: true }).nullable();
    table.text('last_error').nullable();
  });
  await knex.schema.createTable('outage_fetch_log', (table) => {
    table.bigIncrements('id').primary();
    table.string('provider', 32).notNullable();
    table.boolean('ok').notNullable();
    table.integer('status').nullable();
    table.integer('ms').nullable();
    table.text('error').nullable();
    table.timestamp('at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(['provider', 'at']);
  });
};

/** @param { import("knex").Knex } knex */
export const down = async (knex) => {
  await knex.schema.dropTableIfExists('outage_fetch_log');
  await knex.schema.dropTableIfExists('outage_region_status');
  await knex.schema.dropTableIfExists('outage_snapshots');
};
