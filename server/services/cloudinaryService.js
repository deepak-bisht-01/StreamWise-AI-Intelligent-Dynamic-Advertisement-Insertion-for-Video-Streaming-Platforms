const { cloudinary } = require('../config/cloudinary');
const {
  VIDEO_FOLDER,
  THUMBNAIL_FOLDER,
} = require('../utils/constants');
const { ApiError } = require('../utils/ApiError');
const { toNumber } = require('../utils/helpers');
const logger = require('../utils/logger');

async function getVideoMetadata(publicId, timeout = 10000) {
  try {
    const resource = await Promise.race([
      cloudinary.api.resource(publicId, {
        resource_type: 'video',
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Cloudinary API timeout')), timeout)
      )
    ]);

    return {
      duration: toNumber(resource.duration),
      fileSize: toNumber(resource.bytes),
      url: resource.secure_url,
    };
  } catch (error) {
    logger.error({ message: 'Failed to fetch video metadata', error: error.message, publicId });
    throw new ApiError(502, 'Failed to fetch video metadata from Cloudinary');
  }
}

async function deleteAsset(publicId, resourceType, retries = 3) {
  if (!publicId) {
    return;
  }

  for (let i = 0; i < retries; i++) {
    try {
      await cloudinary.uploader.destroy(publicId, {
        resource_type: resourceType,
        invalidate: true,
      });
      return;
    } catch (error) {
      if (i === retries - 1) {
        logger.error({ message: 'Failed to delete asset after retries', error: error.message, publicId, resourceType });
        throw error;
      }
      logger.warn({ message: 'Retrying asset deletion', attempt: i + 1, publicId });
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}

async function deleteVideoAssets(videoPublicId, thumbnailPublicId) {
  const results = await Promise.allSettled([
    deleteAsset(videoPublicId, 'video'),
    deleteAsset(thumbnailPublicId, 'image'),
  ]);

  const failed = results.filter((result) => result.status === 'rejected');
  if (failed.length === results.length) {
    throw new ApiError(502, 'Failed to delete media from Cloudinary');
  }

  if (failed.length > 0) {
    logger.warn({ message: 'Partial asset deletion failure', failed: failed.length, total: results.length });
  }
}

function extractUploadInfo(file, fallbackFolder) {
  const publicId = file.public_id || file.filename;
  const url = file.secure_url || file.path;

  if (!publicId || !url) {
    throw new ApiError(502, `Cloudinary did not return a valid ${fallbackFolder} asset`);
  }

  return {
    publicId,
    url,
    duration: toNumber(file.duration),
    bytes: toNumber(file.bytes || file.size),
  };
}

module.exports = {
  getVideoMetadata,
  deleteVideoAssets,
  extractUploadInfo,
  VIDEO_FOLDER,
  THUMBNAIL_FOLDER,
};
