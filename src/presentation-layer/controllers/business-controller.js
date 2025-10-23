import ApiError from '../../middlewares/exceptions/api-errors.js';
import businessModel from '../../data-layer/models/business-model.js';

const queryMappings = {
  id: 'id',
  slug: 'slug',
  user_id: 'user_id',
  title: 'title',
  description: 'description',
  sortField: 'sort_field',
  sortDirection: 'sortDirection',
};

class businessController {
  async getBusiness(req, res) {
    let conditions = {};
    try {
      const queryParams = req.query;
      for (const key in queryParams) {
        const mappedKey = queryMappings[key];
        if (mappedKey) {
          conditions[mappedKey] = queryParams[key];
        }
      }
      const response = await businessModel.getBusinessByCondition(conditions);
      if (!response) {
        return res.json(ApiError.NotFound('business not found'));
      }
      return res.json(response);
    } catch (error) {
      console.error(error);
      return res.json(ApiError.IntServError(error.message));
    }
  }
  async createBusiness(req, res) {
    const business = req.body;
    console.log('BUSINESS: ', business);
    try {
      const response = await businessModel.createBusiness(business);
      if (!response) {
        return res.json(ApiError.BadRequest('Business not created'));
      }
      return res.json(response);
    } catch (error) {
      console.error(error);
      return res.json(ApiError.IntServError(error.message));
    }
  }
}

export default new businessController();
