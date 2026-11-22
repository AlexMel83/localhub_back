/**
 * Address -> outage subqueue directory imported from operator XLSX files.
 * @param { import("knex").Knex } knex
 */
export const up = async (knex) => {
  await knex.schema.createTable('outage_address_files', (table) => {
    table.string('url', 512).primary();
    table.string('region', 64).notNullable();
    table.string('rem', 128).notNullable();
    table.string('last_modified', 64).nullable();
    table.integer('rows').notNullable().defaultTo(0);
    table.timestamp('imported_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('outage_addresses', (table) => {
    table.bigIncrements('id').primary();
    table.string('region', 64).notNullable();
    table.string('rem', 128).notNullable();
    table.string('file_url', 512).notNullable();
    table.date('file_date').nullable();
    table.string('settlement', 128).notNullable();
    table.string('settlement_norm', 128).notNullable();
    table.string('street', 256).notNullable();
    table.string('street_norm', 256).notNullable();
    table.specificType('houses', 'text[]').notNullable();
    table.string('queue', 8).notNullable();
    table.index(['region', 'settlement_norm']);
    table.index(['street_norm']);
    table.index(['file_url']);
  });
};

/** @param { import("knex").Knex } knex */
export const down = async (knex) => {
  await knex.schema.dropTableIfExists('outage_addresses');
  await knex.schema.dropTableIfExists('outage_address_files');
};
