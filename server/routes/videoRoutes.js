const express = require('express');
const videoController = require('../controllers/videoController');
const { uploadVideoAssets, validateUploadedFiles } = require('../middlewares/upload');
const { createVideoValidators, videoIdValidators, paginationValidators } = require('../middlewares/videoValidators');
const { uploadLimiter, deleteLimiter } = require('../middlewares/rateLimiter');

const router = express.Router();

router.get('/', paginationValidators, videoController.getVideos);
router.get('/stats', videoController.getStats);
router.get('/:id', videoIdValidators, videoController.getVideo);
router.delete('/:id', videoIdValidators, deleteLimiter, videoController.deleteVideo);
router.post(
  '/upload',
  uploadLimiter,
  uploadVideoAssets,
  validateUploadedFiles,
  createVideoValidators,
  videoController.uploadVideo,
);

module.exports = router;
