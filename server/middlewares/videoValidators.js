const { body, param, query } = require('express-validator');
const { validateRequest } = require('../middlewares/validate');

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const titleRules = body('title')
  .trim()
  .notEmpty()
  .withMessage('Title is required')
  .isLength({ min: 3, max: 120 })
  .withMessage('Title must be between 3 and 120 characters')
  .matches(/^[a-zA-Z0-9\s\-_.,!?'"()]+$/)
  .withMessage('Title contains invalid characters');

const descriptionRules = body('description')
  .trim()
  .notEmpty()
  .withMessage('Description is required')
  .isLength({ min: 10, max: 2000 })
  .withMessage('Description must be between 10 and 2000 characters');

const idRules = param('id')
  .trim()
  .notEmpty()
  .withMessage('Video id is required')
  .matches(UUID_REGEX)
  .withMessage('Video id must be a valid UUID');

const paginationRules = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer')
    .toInt(),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100')
    .toInt(),
];

const createVideoValidators = [titleRules, descriptionRules, validateRequest];
const videoIdValidators = [idRules, validateRequest];
const paginationValidators = [...paginationRules, validateRequest];

module.exports = {
  createVideoValidators,
  videoIdValidators,
  paginationValidators,
};
