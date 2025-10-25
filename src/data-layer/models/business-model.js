import knex from '../../../config/knex.config.js';

const businessTable = 'business';
const businessFields = [
  'id',
  'user_id',
  'title',
  'slug',
  'type',
  'rating',
  'description',
  'address',
  'contacts',
  'working_hours',
  'price',
  'shooting_date',
  'latitude_fact',
  'longitude_fact',
  'latitude',
  'longitude',
  'view_mode',
  'yaw',
  'heading',
  'tilt',
  'pano_id',
  'thumbnail_url',
  'image_width',
  'image_height',
  'created_at',
  'updated_at',
];

export default {
  async getBusinessByCondition(condition = {}, trx = knex) {
    try {
      const businessQuery = trx(businessTable).select(businessFields);
      let sort;

      if (condition.sortDirection) {
        sort = condition.sortDirection;
        delete condition.sortDirection;
      }

      for (const [key, value] of Object.entries(condition)) {
        if (key === 'title')
          businessQuery.where('title', 'ilike', `%${value}%`);
        else if (key === 'description')
          businessQuery.where('description', 'ilike', `%${value}%`);
        else if (key === 'sort_field')
          businessQuery.orderBy(value, sort === 'down' ? 'desc' : 'asc');
        else businessQuery.where(key, value);
      }

      const result = await businessQuery;
      return result.length ? result : null;
    } catch (error) {
      console.error('Error fetching business:', error.message);
      throw error;
    }
  },

  async createBusiness(business, trx = knex) {
    const [created] = await trx(businessTable)
      .insert(business)
      .returning(businessFields);
    return created || null;
  },

  async updateBusiness(fields, trx = knex) {
    const [updated] = await trx(businessTable)
      .where({ id: fields.id })
      .update(fields)
      .returning(businessFields);
    return updated || null;
  },

  async removeBusiness(id) {
    const deletedCount = await knex(businessTable).where({ id }).del();
    return deletedCount > 0;
  },
};
