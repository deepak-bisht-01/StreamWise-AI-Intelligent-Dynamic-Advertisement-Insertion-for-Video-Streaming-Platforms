const { asyncHandler } = require('../utils/asyncHandler');
const { ApiResponse } = require('../utils/ApiResponse');
const { sanitizeInput } = require('../utils/sanitizer');
const videoService = require('../services/videoService');
const logger = require('../utils/logger');

const uploadVideo = asyncHandler(async (req, res) => {
  const sanitizedData = sanitizeInput({
    title: req.body.title,
    description: req.body.description,
  });

  const video = await videoService.createVideoRecord({
    title: sanitizedData.title.trim(),
    description: sanitizedData.description.trim(),
    videoFile: req.files.video[0],
    thumbnailFile: req.files.thumbnail[0],
  });

  logger.info({ message: 'Video uploaded successfully', videoId: video.id, requestId: req.id });
  res.status(201).json(ApiResponse.success('Video uploaded successfully', video));
});

const getVideos = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 12;
  const result = await videoService.listVideos(page, limit);
  
  logger.info({ message: 'Videos fetched successfully', count: result.videos.length, requestId: req.id });
  res.status(200).json(ApiResponse.success('Videos fetched successfully', result));
});

const getVideo = asyncHandler(async (req, res) => {
  const video = await videoService.getVideoById(req.params.id);
  const related = await videoService.getRelatedVideos(req.params.id);
  
  logger.info({ message: 'Video fetched successfully', videoId: req.params.id, requestId: req.id });
  res.status(200).json(ApiResponse.success('Video fetched successfully', { video, related }));
});

const deleteVideo = asyncHandler(async (req, res) => {
  const video = await videoService.deleteVideo(req.params.id);
  
  logger.info({ message: 'Video deleted successfully', videoId: req.params.id, requestId: req.id });
  res.status(200).json(ApiResponse.success('Video deleted successfully', video));
});

const getStats = asyncHandler(async (req, res) => {
  const stats = await videoService.getLibraryStats();
  
  logger.info({ message: 'Library stats fetched successfully', requestId: req.id });
  res.status(200).json(ApiResponse.success('Library stats fetched successfully', stats));
});

module.exports = {
  uploadVideo,
  getVideos,
  getVideo,
  deleteVideo,
  getStats,
};
