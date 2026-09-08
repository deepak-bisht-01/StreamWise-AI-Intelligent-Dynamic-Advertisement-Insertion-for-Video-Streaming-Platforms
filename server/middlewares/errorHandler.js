const { ApiError } = require('../utils/ApiError');
const { ApiResponse } = require('../utils/ApiResponse');
const { env } = require('../config/env');
const {
  deleteVideoAssets,
  extractUploadInfo,
} = require('../services/cloudinaryService');
const logger = require('../utils/logger');

function notFoundHandler(req, res, next) {
  next(new ApiError(404, `Route not found: ${req.originalUrl}`));
}

async function cleanupUploadedAssets(req) {
  const videoFile = req.files?.video?.[0];
  const thumbnailFile = req.files?.thumbnail?.[0];

  if (!videoFile && !thumbnailFile) {
    return;
  }

  try {
    const videoInfo = videoFile ? extractUploadInfo(videoFile, 'videos') : {};
    const thumbnailInfo = thumbnailFile ? extractUploadInfo(thumbnailFile, 'thumbnails') : {};
    await deleteVideoAssets(videoInfo.publicId, thumbnailInfo.publicId);
  } catch (cleanupError) {
    logger.error({ 
      message: 'Failed to clean up Cloudinary assets', 
      error: cleanupError.message, 
      requestId: req.id 
    });
  }
}

async function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    next(err);
    return;
  }

  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal server error';

  if (err.name === 'MulterError') {
    statusCode = 400;
    if (err.code === 'LIMIT_FILE_SIZE') {
      message = `File is too large. Maximum video size is ${env.limits.maxVideoSizeMb}MB`;
    } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      message = 'Unexpected file field';
    } else {
      message = err.message;
    }
  }

  if (err.name === 'ValidationError') {
    statusCode = 422;
  }

  if (req.files && statusCode >= 400 && statusCode < 500) {
    await cleanupUploadedAssets(req);
  }

  // Log error with context
  logger.error({
    message: 'API error occurred',
    error: err.message,
    statusCode,
    requestId: req.id,
    url: req.url,
    method: req.method,
    stack: env.isProduction ? undefined : err.stack,
  });

  const payload = ApiResponse.fail(message, env.isProduction ? null : err.details || null);

  res.status(statusCode).json(payload);
}

module.exports = { errorHandler, notFoundHandler };
