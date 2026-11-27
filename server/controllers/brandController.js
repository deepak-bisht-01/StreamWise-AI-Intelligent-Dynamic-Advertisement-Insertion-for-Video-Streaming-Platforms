const { asyncHandler } = require('../utils/asyncHandler');
const { ApiResponse } = require('../utils/ApiResponse');
const { ApiError } = require('../utils/ApiError');
const brandService = require('../services/brandService');

const listCampaigns = asyncHandler(async (req, res) => {
  const campaigns = await brandService.listCampaigns(req.db);
  res.json(ApiResponse.success('Brand campaigns loaded', campaigns));
});

const createCampaign = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'Choose an image or video creative');
  const campaign = await brandService.createCampaignFromUpload({
    db: req.db,
    userId: req.user.id,
    file: req.file,
    fields: req.body || {},
  });
  res.status(201).json(ApiResponse.success('Brand campaign created', campaign));
});

const importCampaigns = asyncHandler(async (req, res) => {
  const result = await brandService.importCampaigns(req.db, req.user.id, req.body?.rows);
  res.status(201).json(ApiResponse.success('Campaign import finished', result));
});

const deleteCampaign = asyncHandler(async (req, res) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) {
    throw new ApiError(400, 'Campaign id must be a valid UUID');
  }
  const result = await brandService.deleteCampaign(req.db, req.params.id);
  res.json(ApiResponse.success('Brand campaign deleted', result));
});

module.exports = { listCampaigns, createCampaign, importCampaigns, deleteCampaign };
