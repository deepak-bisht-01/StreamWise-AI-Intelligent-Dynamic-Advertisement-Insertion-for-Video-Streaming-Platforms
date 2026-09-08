const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const { cloudinary } = require('../config/cloudinary');
const { ApiError } = require('../utils/ApiError');
const { getExtension } = require('../utils/helpers');
const {
  VIDEO_FOLDER,
  THUMBNAIL_FOLDER,
  VIDEO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  VIDEO_MIME_TYPES,
  IMAGE_MIME_TYPES,
  MAX_VIDEO_BYTES,
  MAX_THUMBNAIL_BYTES,
} = require('../utils/constants');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const isVideo = file.fieldname === 'video';
    const extension = getExtension(file.originalname);

    return {
      folder: isVideo ? VIDEO_FOLDER : THUMBNAIL_FOLDER,
      resource_type: isVideo ? 'video' : 'image',
      allowed_formats: isVideo ? VIDEO_EXTENSIONS : IMAGE_EXTENSIONS,
      public_id: `${uuidv4()}-${extension || file.fieldname}`,
    };
  },
});

function fileFilter(req, file, cb) {
  const extension = getExtension(file.originalname);

  if (file.fieldname === 'video') {
    const allowedMime = Boolean(VIDEO_MIME_TYPES[file.mimetype]);
    const allowedExt = VIDEO_EXTENSIONS.includes(extension);
    
    if (!allowedMime && !allowedExt) {
      logger.warn({ 
        message: 'Invalid video file type', 
        mimetype: file.mimetype, 
        extension,
        originalname: file.originalname 
      });
      cb(new ApiError(400, 'Video must be mp4, mov, avi, or mkv'));
      return;
    }
    
    // Additional MIME type validation
    if (allowedMime && !allowedExt) {
      logger.warn({ 
        message: 'Video MIME type allowed but extension suspicious', 
        mimetype: file.mimetype, 
        extension,
        originalname: file.originalname 
      });
    }
    
    cb(null, true);
    return;
  }

  if (file.fieldname === 'thumbnail') {
    const allowedMime = Boolean(IMAGE_MIME_TYPES[file.mimetype]);
    const allowedExt = IMAGE_EXTENSIONS.includes(extension);
    
    if (!allowedMime && !allowedExt) {
      logger.warn({ 
        message: 'Invalid thumbnail file type', 
        mimetype: file.mimetype, 
        extension,
        originalname: file.originalname 
      });
      cb(new ApiError(400, 'Thumbnail must be jpg, jpeg, png, or webp'));
      return;
    }
    
    // Additional MIME type validation
    if (allowedMime && !allowedExt) {
      logger.warn({ 
        message: 'Thumbnail MIME type allowed but extension suspicious', 
        mimetype: file.mimetype, 
        extension,
        originalname: file.originalname 
      });
    }
    
    cb(null, true);
    return;
  }

  logger.warn({ message: 'Unexpected file field', fieldname: file.fieldname });
  cb(new ApiError(400, 'Unexpected file field'));
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_VIDEO_BYTES,
    fieldSize: MAX_VIDEO_BYTES,
  },
});

const uploadVideoAssets = upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 },
]);

function validateUploadedFiles(req, res, next) {
  const videoFile = req.files?.video?.[0];
  const thumbnailFile = req.files?.thumbnail?.[0];

  if (!videoFile) {
    next(new ApiError(400, 'A video file is required'));
    return;
  }

  if (!thumbnailFile) {
    next(new ApiError(400, 'A thumbnail image is required'));
    return;
  }

  const videoSize = videoFile.bytes || videoFile.size || 0;
  const thumbnailSize = thumbnailFile.bytes || thumbnailFile.size || 0;

  if (videoSize > MAX_VIDEO_BYTES) {
    logger.warn({ message: 'Video size exceeded limit', size: videoSize, limit: MAX_VIDEO_BYTES });
    next(new ApiError(400, `Video exceeds the ${MAX_VIDEO_BYTES / (1024 * 1024)}MB limit`));
    return;
  }

  if (thumbnailSize > MAX_THUMBNAIL_BYTES) {
    logger.warn({ message: 'Thumbnail size exceeded limit', size: thumbnailSize, limit: MAX_THUMBNAIL_BYTES });
    next(new ApiError(400, `Thumbnail exceeds the ${MAX_THUMBNAIL_BYTES / (1024 * 1024)}MB limit`));
    return;
  }

  // Validate file size is reasonable (not empty)
  if (videoSize === 0) {
    next(new ApiError(400, 'Video file is empty'));
    return;
  }

  if (thumbnailSize === 0) {
    next(new ApiError(400, 'Thumbnail file is empty'));
    return;
  }

  next();
}

module.exports = {
  uploadVideoAssets,
  validateUploadedFiles,
};
