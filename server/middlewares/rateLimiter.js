const rateLimit = require('express-rate-limit');
const { env } = require('../config/env');

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.',
    data: null
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    if (env.isProduction) return false;
    return true; // Skip rate limiting in development
  }
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // limit each IP to 10 uploads per hour
  message: {
    success: false,
    message: 'Too many upload attempts, please try again later.',
    data: null
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const deleteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // limit each IP to 20 deletions per 15 minutes
  message: {
    success: false,
    message: 'Too many delete attempts, please try again later.',
    data: null
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const rateLimiter = generalLimiter;

module.exports = {
  rateLimiter,
  uploadLimiter,
  deleteLimiter
};