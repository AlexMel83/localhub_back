import knex from '../../../config/knex.config.js';

const businessTable = 'business';
const businessFields = [
  'business.id',
  'business.user_id',
  'business.title',
  'business.slug',
  'business.type',
  'business.rating',
  'business.description',
  'business.address',
  'business.contacts',
  'business.working_hours',
  'business.price',
  'business.working_hours',
  'business.shooting_date',
  'business.latitude_fact',
  'business.longitude_fact',
  'business.latitude',
  'business.longitude',
  'business.view_mode',
  'business.yaw',
  'business.heading',
  'business.tilt',
  'business.pano_id',
  'business.thumbnail_url',
  'business.image_width',
  'business.image_height',
  'business.created_at',
  'business.updated_at',
];

const conditionHandlers = {
  id: (businessQuery, value) => businessQuery.where('business.id', value),
  slug: (businessQuery, value) => businessQuery.where('business.slug', value),
  user_id: (businessQuery, value) =>
    businessQuery.where('business.user_id', value),
  title: (businessQuery, value) =>
    businessQuery.where('business.title', 'ilike', `%${value}%`),
  description: (businessQuery, value) =>
    businessQuery.where('business.description', 'ilike', `%${value}%`),
  sort_field: (businessQuery, value, sort) => {
    if (value) {
      businessQuery.orderBy(value, sort === 'down' ? 'desc' : 'asc');
    }
  },
};

export default {
  async getBusinessByCondition(condition = {}, trx = knex) {
    let sort;
    if ('sortDirection' in condition) {
      sort = condition.sortDirection;
      delete condition.sortDirection;
    }
    try {
      const businessQuery = trx(businessTable).select(businessFields);

      for (const [key, value] of Object.entries(condition)) {
        const handler = conditionHandlers[key];
        if (handler) {
          handler(businessQuery, value, sort);
        } else {
          businessQuery.where(key, value);
        }
      }

      const result = await businessQuery;
      if (!result.length) {
        return null;
      }

      return result;
    } catch (error) {
      console.error('Error fetching business by condition:', error.message);
      throw error;
    }
  },
};
