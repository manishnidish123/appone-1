const internals = {
  CUSTOM_ERROR: Symbol('isCustomError'),
};

class ErrorHandler extends Error {
  constructor(message, status) {
    const errorMessage = message || 'Internal Server Error';
    super(errorMessage);
    Error.captureStackTrace(this, this.constructor);
    this.status = status || 500;
    this.message = errorMessage;
    this.name = this.constructor.name;
    this[internals.CUSTOM_ERROR] = true;
  }
}

function isCustomError(error) {
  return error[internals.CUSTOM_ERROR] === true;
}
class ValidationError extends ErrorHandler {
  constructor(params, message) {
    super(message || 'Invalid parameters submitted', 422);
    this.params = params;
  }
}

class NotFoundError extends ErrorHandler {
  constructor(message) {
    super(message || 'Requested entity could not be found', 404);
  }
}

module.exports = {
  ValidationError,
  NotFoundError,
  ErrorHandler,
  isCustomError,
};
