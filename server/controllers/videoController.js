const { asyncHandler } = require('../utils/asyncHandler');
const { ApiResponse } = require('../utils/ApiResponse');
const { sanitizeInput } = require('../utils/sanitizer');
const videoService = require('../services/videoService');
const adAnalysis = require('../services/adAnalysis');
const { deleteAdResults } = require('../services/adInsertionService');
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
    uploadedBy: req.user.id,
    creatorName: req.profile.display_name || req.user.email,
  });

  logger.info({ message: 'Video submitted for admin review', videoId: video.id, creatorId: req.user.id, requestId: req.id });
  res.status(201).json(ApiResponse.success('Video uploaded successfully', {
    id: video.id,
    title: video.title,
    description: video.description,
    creatorName: video.creatorName,
    createdAt: video.createdAt,
    analysisStatus: video.analysisStatus,
    adReviewEnabled: false,
  }));
});

const getVideos = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 12;
  const result = await videoService.listApprovedVideos(page, limit, req.profile, req.sessionId);
  
  logger.info({ message: 'Videos fetched successfully', count: result.videos.length, requestId: req.id });
  res.status(200).json(ApiResponse.success('Videos fetched successfully', result));
});

const getAdminVideos = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const result = await videoService.listVideos(page, limit, req.user.id, req.sessionId);
  res.status(200).json(ApiResponse.success('Admin video library loaded', result));
});

const getMyVideos = asyncHandler(async (req, res) => {
  const result = await videoService.listMyVideos(req.user.id);
  res.status(200).json(ApiResponse.success('Your video submissions loaded', result));
});

const selectVideoForAdReview = asyncHandler(async (req, res) => {
  const video = await videoService.enableAdReview(req.params.id);
  adAnalysis.enqueue(video.id);
  logger.info({ message: 'Admin selected video for ad review', videoId: video.id, requestId: req.id });
  res.status(202).json(ApiResponse.success('Video selected. Billboard analysis has been queued.', {
    id: video.id,
    adReviewEnabled: true,
    analysisStatus: video.analysis_status || 'pending',
  }));
});

const setAdvertiserPriorityTier = asyncHandler(async (req, res) => {
  const result = await videoService.setAdvertiserPriorityTier(req.params.id, req.body?.priorityTier);
  res.json(ApiResponse.success('Advertiser video priority updated', result));
});

const getVideo = asyncHandler(async (req, res) => {
  const isAdmin = req.profile?.role === 'admin';
  const video = isAdmin
    ? await videoService.getVideoById(req.params.id, req.user.id, req.sessionId)
    : await videoService.getApprovedVideoById(req.params.id, req.profile, req.sessionId);
  const related = isAdmin
    ? await videoService.getRelatedVideos(req.params.id, req.user.id, req.sessionId)
    : await videoService.getRelatedApprovedVideos(req.params.id, req.profile, req.sessionId);
  
  logger.info({ message: 'Video fetched successfully', videoId: req.params.id, requestId: req.id });
  res.status(200).json(ApiResponse.success('Video fetched successfully', { video, related }));
});

const deleteVideo = asyncHandler(async (req, res) => {
  const video = await videoService.deleteVideo(req.params.id);
  await adAnalysis.deletePreview(req.params.id);
  await deleteAdResults(req.params.id);
  
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
  getAdminVideos,
  getMyVideos,
  selectVideoForAdReview,
  setAdvertiserPriorityTier,
  getVideo,
  deleteVideo,
  getStats,
};
