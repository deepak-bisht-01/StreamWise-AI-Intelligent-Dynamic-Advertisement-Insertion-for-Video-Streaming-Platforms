const { asyncHandler } = require('../utils/asyncHandler');
const { ApiResponse } = require('../utils/ApiResponse');
const { ApiError } = require('../utils/ApiError');
const { insertAd, deleteAdResult } = require('../services/adInsertionService');

const addAd = asyncHandler(async (req, res) => {
  const { slotId } = req.body || {};
  if (!slotId) throw new ApiError(400, 'Choose a detected billboard slot');
  if (!req.file) throw new ApiError(400, 'Choose an ad image or video');

  const result = await insertAd({
    videoId: req.params.id,
    slotId,
    creative: req.file,
  });
  res.status(201).json(ApiResponse.success('Ad inserted into the detected billboard slot', result));
});

const removeAd = asyncHandler(async (req, res) => {
  const result = await deleteAdResult({ videoId: req.params.id, adId: req.params.adId });
  res.status(200).json(ApiResponse.success('Ad result deleted successfully', result));
});

module.exports = { addAd, removeAd };
