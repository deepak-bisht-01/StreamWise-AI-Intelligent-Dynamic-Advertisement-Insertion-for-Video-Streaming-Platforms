const { asyncHandler } = require('../utils/asyncHandler');
const { ApiResponse } = require('../utils/ApiResponse');
const { processVideoWithColab } = require('../services/aiProcessingService');
const logger = require('../utils/logger');

const processVideo = asyncHandler(async (req, res) => {
  const { inputVideoPath, outputVideoPath, config } = req.body || {};

  const result = await processVideoWithColab({
    inputVideoPath,
    outputVideoPath,
    config,
  });

  logger.info({ message: 'AI processing request completed', requestId: req.id, result });
  res.status(200).json(ApiResponse.success('AI processing completed successfully', result));
});

module.exports = {
  processVideo,
};
