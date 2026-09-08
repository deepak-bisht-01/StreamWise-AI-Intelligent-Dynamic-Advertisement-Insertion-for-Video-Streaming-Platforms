const { validationResult } = require('express-validator');
const { ApiError } = require('../utils/ApiError');

function validateRequest(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const details = errors.array().map((error) => ({
      field: error.path,
      message: error.msg,
    }));
    next(new ApiError(422, details[0]?.message || 'Validation failed', details));
    return;
  }
  next();
}

module.exports = { validateRequest };
