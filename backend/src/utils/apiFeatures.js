import { PAGINATION } from '../config/constants.js';

/**
 * Advanced query builder for Mongoose.
 * Supports: filtering, searching, sorting, field selection, and pagination.
 *
 * Usage in controller:
 *   const features = new ApiFeatures(Model.find(), req.query)
 *     .filter()
 *     .search(['name', 'code'])
 *     .sort()
 *     .select()
 *     .paginate();
 *   const { docs, pagination } = await features.exec();
 */
export class ApiFeatures {
  constructor(query, queryString) {
    this.query = query;
    this.queryString = queryString;
    this._pagination = {};
    this._totalCount = 0;
  }

  /**
   * Advanced filtering.
   * Supports MongoDB operators via query params:
   *   ?orderQty[gte]=1000&status=ACTIVE
   *   ?createdAt[gte]=2024-01-01&createdAt[lte]=2024-12-31
   */
  filter() {
    const queryObj = { ...this.queryString };
    const excludedFields = ['page', 'limit', 'sort', 'fields', 'search', 'searchFields', 'populate'];
    excludedFields.forEach((f) => delete queryObj[f]);

    // Convert filter operators: gte, gt, lte, lt, ne, in, nin, regex
    let queryStr = JSON.stringify(queryObj);
    queryStr = queryStr.replace(
      /\b(gte|gt|lte|lt|ne|in|nin|regex)\b/g,
      (match) => `$${match}`,
    );

    const parsed = JSON.parse(queryStr);

    // Handle comma-separated 'in' values: ?status=ACTIVE,COMPLETED
    for (const key in parsed) {
      if (typeof parsed[key] === 'string' && parsed[key].includes(',') && !key.includes('$')) {
        parsed[key] = { $in: parsed[key].split(',') };
      }
    }

    this.query = this.query.find(parsed);
    return this;
  }

  /**
   * Full-text search across specified fields.
   *   ?search=Versuni&searchFields=name,code
   */
  search(defaultFields = []) {
    const searchTerm = this.queryString.search;
    if (!searchTerm) return this;

    const fields = this.queryString.searchFields
      ? this.queryString.searchFields.split(',')
      : defaultFields;

    if (fields.length === 0) return this;

    const searchRegex = new RegExp(searchTerm, 'i');
    const orConditions = fields.map((field) => ({ [field]: searchRegex }));
    this.query = this.query.find({ $or: orConditions });
    return this;
  }

  /**
   * Sorting.
   *   ?sort=-createdAt,name  →  sort by createdAt DESC, name ASC
   *   Default: -createdAt
   */
  sort() {
    if (this.queryString.sort) {
      const sortBy = this.queryString.sort.split(',').join(' ');
      this.query = this.query.sort(sortBy);
    } else {
      this.query = this.query.sort('-createdAt');
    }
    return this;
  }

  /**
   * Field selection / projection.
   *   ?fields=name,code,status
   */
  select() {
    if (this.queryString.fields) {
      const fields = this.queryString.fields.split(',').join(' ');
      this.query = this.query.select(fields);
    } else {
      this.query = this.query.select('-__v');
    }
    return this;
  }

  /**
   * Pagination.
   *   ?page=2&limit=25
   */
  paginate() {
    const page  = Math.max(1, parseInt(this.queryString.page, 10)  || PAGINATION.DEFAULT_PAGE);
    const limit = Math.min(
      PAGINATION.MAX_LIMIT,
      Math.max(1, parseInt(this.queryString.limit, 10) || PAGINATION.DEFAULT_LIMIT),
    );
    const skip = (page - 1) * limit;

    this.query = this.query.skip(skip).limit(limit);
    this._pagination = { page, limit, skip };
    return this;
  }

  /**
   * Populate references.
   *   ?populate=partyId,skuId
   *   or pass a static populate config
   */
  populateRefs(defaultPopulate = null) {
    const populate = this.queryString.populate;
    if (populate) {
      populate.split(',').forEach((field) => {
        this.query = this.query.populate(field.trim());
      });
    } else if (defaultPopulate) {
      if (Array.isArray(defaultPopulate)) {
        defaultPopulate.forEach((p) => { this.query = this.query.populate(p); });
      } else {
        this.query = this.query.populate(defaultPopulate);
      }
    }
    return this;
  }

  /**
   * Execute the query and return docs + pagination meta.
   */
  async exec() {
    // Clone the query filter to count total documents
    const filterConditions = this.query.getFilter();
    const model = this.query.model;
    this._totalCount = await model.countDocuments(filterConditions);

    const docs = await this.query.lean();

    const { page = 1, limit = PAGINATION.DEFAULT_LIMIT } = this._pagination;
    const totalPages = Math.ceil(this._totalCount / limit);

    return {
      docs,
      pagination: {
        total:      this._totalCount,
        page,
        limit,
        totalPages,
        hasNext:    page < totalPages,
        hasPrev:    page > 1,
      },
    };
  }
}
