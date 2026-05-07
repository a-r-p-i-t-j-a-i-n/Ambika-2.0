import { AppError } from '../utils/apiResponse.js';

/**
 * Joi validation middleware factory.
 * @param {import('joi').ObjectSchema} schema — the Joi schema to validate against
 * @param {'body'|'query'|'params'} source — which part of the request to validate
 */
const validate = (schema, source = 'body') => (req, _res, next) => {
  const { error, value } = schema.validate(req[source], {
    abortEarly: false,
    stripUnknown: true,
    errors: { wrap: { label: '' } },
  });

  if (error) {
    const messages = error.details.map((d) => d.message).join('; ');
    return next(new AppError(messages, 422));
  }

  // Replace with sanitised values
  req[source] = value;
  next();
};

export default validate;
