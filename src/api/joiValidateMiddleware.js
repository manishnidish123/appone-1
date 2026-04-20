const joiValidate = require('./joiValidate');

const Sections = {
  BODY: 'body',
  QUERY: 'query',
  PARAMS: 'params',
};

const joiValidateMiddleware =
  (schema, config = {}) =>
  async (req, res, next) => {
    const { checkParam = Sections.BODY, ...options } = config;
    try {
      // const value =
      const value = await joiValidate(schema, req[checkParam], options);
      // Use sanitised parameters
      req.body = value;
      next();
    } catch (error) {
      next(error);
    }
  };

module.exports = {
  joiValidateMiddleware,
  Sections,
};
