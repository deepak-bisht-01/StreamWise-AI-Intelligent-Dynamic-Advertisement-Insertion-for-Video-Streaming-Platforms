const { asyncHandler } = require('../utils/asyncHandler');
const { ApiResponse } = require('../utils/ApiResponse');
const { getPersonalizedAd } = require('../services/personalizedAdService');

const getForViewer = asyncHandler(async (req, res) => {
  const result = await getPersonalizedAd({
    db: req.db,
    user: req.user,
    videoId: req.params.id,
  });
  res.json(ApiResponse.success('Regional ad selection completed', result));
});

module.exports = { getForViewer };
