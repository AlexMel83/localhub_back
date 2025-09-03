import knex from '../../../config/knex.config.js';

const storesTable = 'stores';
const storesFields = [
  'stores.id',
  'stores.user_id',
  'stores.title',
  'stores.slug',
  'stores.type',
  'stores.rating',
  'stores.description',
  'stores.address',
  'stores.contacts',
  'stores.working_hours',
  'stores.price',
  'stores.working_hours',
  'stores.shooting_date',
  'stores.latitude_fact',
  'stores.longitude_fact',
  'stores.latitude',
  'stores.longitude',
  'stores.view_mode',
  'stores.yaw',
  'stores.heading',
  'stores.tilt',
  'stores.pano_id',
  'stores.thumbnail_url',
  'stores.image_width',
  'stores.image_height',
  'stores.created_at',
  'stores.updated_at',
];

const conditionHandlers = {
  id: (storesQuery, value) => storesQuery.where('stores.id', value),
  slug: (storesQuery, value) => storesQuery.where('stores.slug', value),
  user_id: (storesQuery, value) => storesQuery.where('stores.user_id', value),
  title: (storesQuery, value) =>
    storesQuery.where('stores.title', 'ilike', `%${value}%`),
  description: (storesQuery, value) =>
    storesQuery.where('stores.description', 'ilike', `%${value}%`),
  sort_field: (storesQuery, value, sort) => {
    if (value) {
      storesQuery.orderBy(value, sort === 'down' ? 'desc' : 'asc');
    }
  },
};

export default {
  async getStoresByCondition(condition = {}, trx = knex) {
    let sort;
    if ('sortDirection' in condition) {
      sort = condition.sortDirection;
      delete condition.sortDirection;
    }
    try {
      const storesQuery = trx(storesTable).select(storesFields);

      for (const [key, value] of Object.entries(condition)) {
        const handler = conditionHandlers[key];
        if (handler) {
          handler(storesQuery, value, sort);
        } else {
          storesQuery.where(key, value);
        }
      }

      const result = await storesQuery;
      if (!result.length) {
        return null;
      }

      return result;
    } catch (error) {
      console.error('Error fetching stores by condition:', error.message);
      throw error;
    }
  },
};
