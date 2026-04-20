const logger = require('../logger')(__filename);
const { ValidationError } = require('./exceptions');
const Joi = require('joi');

function processJoiError(validation, joiError) {
  joiError.details.forEach((detail) => {
    const key = detail.path.join('.');
    validation[key] = detail.message.replace(/"/g, '');
  });
}

const isValidationError = (error) => {
  return Joi.ValidationError.isError(error);
};

const throwValidationError = (error) => {
  const validation = {};
  processJoiError(validation, error);
  const validationError = new ValidationError(validation);
  return validationError;
};

/**
 *
 * @param {JoiSchema} schema - JOI Schema object
 * @param {*} payload - payload of request body
 * @returns { error, body } - errors and body
 * @throws {Error}
 */
module.exports = async (schema, payload, options) => {
  try {
    const value = await schema.validateAsync(payload, options);
    logger.debug({
      message: 'Joi validated',
      value,
    });
    return value;
  } catch (e) {
    logger.error({
      message: 'Error in JOI validation',
      isValidationError: isValidationError(e),
    });
    throw throwValidationError(e);
  }
};
